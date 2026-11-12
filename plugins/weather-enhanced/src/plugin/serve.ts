/**
 * Weather Enhanced's answer to the Pebble app, each place's weather as the standard `weather/location`.
 *
 * Most runs answer from the copy each place keeps. A place whose copy has reached the Refresh Interval
 * is fetched again, every due place in one go, from the picked provider within its stops and its
 * ledger. A place the provider could not answer is served, in order, from its copy while that is under
 * three Refresh Intervals old, then from the Open-Meteo reading the failed fetch carried beside it, and
 * last from Open-Meteo asked on its own, while the run has time left. A place none of those can fill is
 * left out, so the Pebble app fills it from its own backend, and a run with nothing to serve answers
 * an error, so the Pebble app fills every place.
 *
 * The Pebble app holds a lock for the whole of a run, so two runs never overlap and each one sees what
 * the last one kept.
 */

import { readSettings } from '../../paf/ts/plugin-app/settings';
import { locationInstance, pebbleAppUnits } from '../../paf/ts/plugin-app/weather';
import type { UnitOverrides, WeatherPlace } from '../../paf/ts/plugin-app/weather';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import type { SourceInstance } from '../../paf/ts/plugin-sources/types';
import type { RequestFn, SendHook } from '../../paf/ts/pkjs/request';
import { keyPrint } from '../../paf/ts/quota/ledger';
import openMeteo from '../../paf/ts/weather/providers/openmeteo';
import owm from '../../paf/ts/weather/providers/owm';
import weatherApi from '../../paf/ts/weather/providers/weatherapi';
import { readingStatus } from '../../paf/ts/weather/reading';
import type { ReadingResult, WeatherReading } from '../../paf/ts/weather/reading';
import { DEFAULTS, REFRESH_MINUTES, SETTINGS_OPTIONS, providerOf } from '../settings';
import type { Provider, ProviderId } from '../settings';
import { isFresh, noteTries, readCopies, readTries, saveCopies, standsIn, triedLately } from './copies';
import type { Copy } from './copies';
import { setStop, stoppedBy } from './gates';
import { openMeter, roomFor, stampSends } from './meter';
import { placesToFetch } from './places';

/** What a run reads from, which a spec stands in for. */
export interface ServeContext {
  pebble: PluginPebble;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  /** The HTTP GET the providers fetch with, normally `pluginRequest`. */
  request: RequestFn;
  /** Reads the time now, normally `Date.now`. */
  clock?: () => number;
}

/** What a run answers with. */
export interface Answer {
  validUntilMs: number;
  instances: SourceInstance[];
}

/** One reading a place could be served from, and whether serving it makes it the place's new copy. */
interface Option {
  reading: WeatherReading;
  fetchedMs: number;
  /** The copy it came from, which is kept as it was, or none for a reading fetched this run. */
  copy?: Copy;
}

const MINUTE_MS = 60 * 1000;

// the longest key either keyed provider hands out, with room to spare
const KEY_MAX = 64;

// the Pebble app stops a run after 20 seconds and a fetch gives up after 8
// an Open-Meteo failover started later than this could not finish inside the run
export const FAILOVER_STARTS_BEFORE_MS = 10 * 1000;

/**
 * The settings, and whether the API keys in them could be read.
 *
 * A key the encrypted storage cannot read, such as while the phone's keystore is locked, reads as
 * empty, the same as one the wearer cleared. The strict read tells the two apart.
 */
async function readAll(context: ServeContext): Promise<{ settings: Record<string, unknown>; keysRead: boolean }> {
  try {
    return { settings: await readSettings(SETTINGS_OPTIONS, context.pebble, context.storage, true), keysRead: true };
  } catch {
    return { settings: await readSettings(SETTINGS_OPTIONS, context.pebble, context.storage), keysRead: false };
  }
}

/** The page's unit overrides, in the form the framework's units take. A value the framework does not know follows the Pebble app. */
function overridesOf(settings: Record<string, unknown>): UnitOverrides {
  return {
    temperature: settings.TEMPERATURE_UNIT as UnitOverrides['temperature'],
    windSpeed: settings.WIND_UNIT as UnitOverrides['windSpeed'],
    pressure: settings.PRESSURE_UNIT as UnitOverrides['pressure'],
  };
}

/** Fetches a reading for some places from one provider. A provider that throws answers every place `NET ERROR`. */
function fetchFrom(provider: ProviderId, places: WeatherPlace[], key: string, request: RequestFn, onSend: SendHook): Promise<ReadingResult[]> {
  const coords = places.map((place) => ({ lat: place.lat, lon: place.lon }));

  return new Promise((resolve) => {
    try {
      if (provider === 'owm') {
        owm.fetchReading(coords, key, request, resolve, onSend);
      } else if (provider === 'weatherapi') {
        weatherApi.fetchReading(coords, key, request, resolve, onSend);
      } else {
        openMeteo.fetchReading(coords, request, resolve, onSend);
      }
    } catch (error) {
      console.log(`Weather Enhanced: ${provider} threw, ${error}`);
      resolve(places.map(() => readingStatus('NET ERROR')));
    }
  });
}

/** The status of an answer, or empty for a reading. */
function statusOf(result: ReadingResult | undefined): string {
  return result && result.ok === false ? result.status : '';
}

/**
 * Stops a provider that turned a fetch away, and Open-Meteo too when the series half of a keyed
 * provider's fetch was rate limited. A bad key is only taken as one when every place came back with
 * it, as each place's call carries the same key.
 */
function noteStops(storage: ServeContext['storage'], provider: ProviderId, print: string, paid: boolean, answers: ReadingResult[], nowMs: number): void {
  const own = answers.map(statusOf);

  if (own.length > 0 && own.every((status) => status === 'INVALID KEY')) {
    setStop(storage, provider, print, 'INVALID KEY', nowMs, paid);
  } else if (own.includes('RATE LIMIT')) {
    // the longest limit any place's answer named, such as WeatherAPI.com's month, holds the provider
    const named = answers.map((answer) => (answer.ok === false && answer.status === 'RATE LIMIT' ? answer.limit : undefined));
    const limit = (['month', 'day', 'hour', 'minute'] as const).find((window) => named.includes(window));

    setStop(storage, provider, print, 'RATE LIMIT', nowMs, paid, limit);
  }

  if (provider !== 'openmeteo') {
    const series = answers.map((answer) => (answer.ok === true ? answer.seriesStatus : statusOf(answer.openMeteo)));

    if (series.includes('RATE LIMIT')) {
      setStop(storage, 'openmeteo', '', 'RATE LIMIT', nowMs, false);
    }
  }
}

/** Whether this run already asked Open-Meteo for a place, beside a keyed provider, and it failed. */
function openMeteoFailed(result: ReadingResult | undefined): boolean {
  if (!result) {
    return false;
  }

  return result.ok === true ? Boolean(result.seriesStatus) : Boolean(result.openMeteo && result.openMeteo.ok === false);
}

/** Who a run asks, which a place's last ask is kept under, and every place the run serves. */
interface Asking {
  provider: Provider;
  key: string;
  print: string;
  paid: boolean;
  listed: string[];
}

/**
 * Fetches the places that are due from the picked provider, as far as its stops and its ledger allow.
 *
 * A keyed provider's fetch also asks Open-Meteo for the series, so Open-Meteo's stop and ledger hold it
 * as well. A place the ledgers have no room for answers `RATE LIMIT` with nothing sent, and so does
 * every place while a stop holds.
 */
async function fetchDue(context: ServeContext, asking: Asking, keysRead: boolean, due: WeatherPlace[], nowMs: number): Promise<Record<string, ReadingResult>> {
  const { provider, key, print, paid } = asking;
  const clock = context.clock || Date.now;
  const storage = context.storage;
  const results: Record<string, ReadingResult> = {};
  const answerAll = (places: WeatherPlace[], status: string) => places.forEach((place) => (results[place.key] = readingStatus(status)));

  if (provider.keySetting && (!key || !keysRead)) {
    answerAll(due, 'NO API KEY');
    return results;
  }

  const stop = stoppedBy(storage, provider.id, print, nowMs) || (provider.keySetting ? stoppedBy(storage, 'openmeteo', '', nowMs) : null);

  if (stop) {
    answerAll(due, stop);
    return results;
  }

  const om = openMeter(storage, 'openmeteo', '', false, nowMs);
  const keyed = provider.keySetting ? openMeter(storage, provider.id, key, paid, nowMs) : null;
  const room = Math.min(roomFor(om, due.length, nowMs), keyed ? roomFor(keyed, due.length, nowMs) : due.length);
  const asked = due.slice(0, room);

  answerAll(due.slice(room), 'RATE LIMIT');

  if (asked.length === 0) {
    return results;
  }

  noteTries(storage, asked.map((place) => place.key), asking.listed, { provider: provider.id, print, atMs: nowMs });

  const answers = await fetchFrom(provider.id, asked, key, context.request, stampSends(storage, keyed ? [om, keyed] : [om], clock));

  asked.forEach((place, index) => (results[place.key] = answers[index]));
  noteStops(storage, provider.id, print, paid, answers, clock());

  return results;
}

/**
 * Fetches Open-Meteo on its own for the places nothing else could fill, as far as its stop and its
 * ledger allow. The ask is kept under the picked provider, so a failover that fails is not tried again
 * until the Refresh Interval either.
 */
async function fetchFailover(context: ServeContext, asking: Asking, places: WeatherPlace[]): Promise<Record<string, ReadingResult>> {
  const clock = context.clock || Date.now;
  const nowMs = clock();
  const results: Record<string, ReadingResult> = {};

  if (stoppedBy(context.storage, 'openmeteo', '', nowMs)) {
    return results;
  }

  const om = openMeter(context.storage, 'openmeteo', '', false, nowMs);
  const asked = places.slice(0, roomFor(om, places.length, nowMs));

  if (asked.length === 0) {
    return results;
  }

  noteTries(context.storage, asked.map((place) => place.key), asking.listed, { provider: asking.provider.id, print: asking.print, atMs: nowMs });

  const answers = await fetchFrom('openmeteo', asked, '', context.request, stampSends(context.storage, [om], clock));

  asked.forEach((place, index) => (results[place.key] = answers[index]));
  noteStops(context.storage, 'openmeteo', '', false, answers, clock());

  return results;
}

/**
 * The weather for every place, as instances in the wearer's order.
 *
 * @param context Where the run reads from.
 * @param startMs When the run started, which decides what is due and how much time is left.
 * @param asked The property names the request asks for, which picks the series. Undefined, as the Pebble app's own Weather app asks, gets every series.
 * @return The instances, and when the first place's copy reaches the Refresh Interval.
 * @throws When no place can be served, so the Pebble app answers its error and fills every place from its backend.
 */
export async function weatherAnswer(context: ServeContext, startMs: number, asked?: string[]): Promise<Answer> {
  const clock = context.clock || Date.now;
  const nowMs = startMs;
  const { settings, keysRead } = await readAll(context);
  const provider = providerOf(settings.PROVIDER);
  const key = provider.keySetting ? String(settings[provider.keySetting] ?? '').trim().slice(0, KEY_MAX) : '';
  const paid = provider.paidSetting ? settings[provider.paidSetting] === true : false;
  // a value the page never offered, such as 0 or a negative, would fetch on every run or almost never
  const refreshMs = Number(REFRESH_MINUTES.includes(String(settings.REFRESH)) ? settings.REFRESH : DEFAULTS.REFRESH) * MINUTE_MS;
  const [{ places, error }, units] = await Promise.all([placesToFetch(context.pebble, settings.PLACES), pebbleAppUnits(context.pebble, overridesOf(settings))]);

  if (places.length === 0) {
    throw new Error(error ? `the places could not be read, ${error}` : "the Pebble app's weather list has no place with coordinates");
  }

  const print = provider.keySetting && key ? keyPrint(key) : '';
  const kept = readCopies(context.storage);
  const copies: Record<string, Copy> = {};

  // a copy made under another provider or key is not served
  // while the keys cannot be read, the provider alone decides, since the key it was made with is unknown
  places.forEach((place) => {
    const copy = kept[place.key];

    if (copy && copy.provider === provider.id && (!keysRead || copy.print === print)) {
      copies[place.key] = copy;
    }
  });

  const asking: Asking = { provider, key, print, paid, listed: places.map((place) => place.key) };
  const tries = readTries(context.storage);
  // a place asked for inside the Refresh Interval waits for it, even when that ask failed
  const due = places.filter((place) => (!copies[place.key] || !isFresh(copies[place.key], refreshMs, nowMs)) && !triedLately(tries[place.key], provider.id, print, refreshMs, nowMs));
  const results = due.length > 0 ? await fetchDue(context, asking, keysRead, due, nowMs) : {};
  const served: Record<string, { instance: SourceInstance; fetchedMs: number }> = {};
  const keep: Record<string, Copy> = {};

  const serveFirst = (place: WeatherPlace, options: Option[]): boolean => {
    for (const option of options) {
      const instance = locationInstance(option.reading, place, units, asked, nowMs);

      if (instance) {
        served[place.key] = { instance, fetchedMs: option.fetchedMs };
        keep[place.key] = option.copy || { provider: provider.id, print, fetchedMs: option.fetchedMs, reading: option.reading };
        return true;
      }
    }

    return false;
  };

  const lacking: WeatherPlace[] = [];

  places.forEach((place) => {
    const result = results[place.key];
    const copy = copies[place.key];
    const fromCopy: Option[] = copy ? [{ reading: copy.reading, fetchedMs: copy.fetchedMs, copy }] : [];

    // a place not asked for this run, fresh or waiting out its last ask, has only its copy
    if (!result) {
      serveFirst(place, copy && (isFresh(copy, refreshMs, nowMs) || standsIn(copy, provider.id, refreshMs, nowMs)) ? fromCopy : []);
      return;
    }

    const options: Option[] = [];

    if (result.ok === true) {
      options.push({ reading: result, fetchedMs: nowMs });
    }

    if (copy && standsIn(copy, provider.id, refreshMs, nowMs)) {
      options.push(...fromCopy);
    }

    if (result.ok === false && result.openMeteo && result.openMeteo.ok === true) {
      options.push({ reading: result.openMeteo, fetchedMs: nowMs });
    }

    // Open-Meteo asked again in the same run would only fail again
    if (!serveFirst(place, options) && provider.id !== 'openmeteo' && !openMeteoFailed(result)) {
      lacking.push(place);
    }
  });

  if (lacking.length > 0 && clock() - startMs < FAILOVER_STARTS_BEFORE_MS) {
    const failover = await fetchFailover(context, asking, lacking);

    lacking.forEach((place) => {
      const result = failover[place.key];

      if (result && result.ok === true) {
        serveFirst(place, [{ reading: result, fetchedMs: nowMs }]);
      }
    });
  }

  saveCopies(context.storage, keep);

  const instances = places.filter((place) => served[place.key]).map((place) => served[place.key].instance);

  if (instances.length === 0) {
    const statuses = places.map((place) => statusOf(results[place.key])).filter(Boolean);

    throw new Error(`no place could be served${statuses.length ? `, ${statuses[0]}` : ''}`);
  }

  const dues = places.filter((place) => served[place.key]).map((place) => {
    const at = served[place.key].fetchedMs + refreshMs;

    return at > nowMs ? at : nowMs + refreshMs;
  });

  return { validUntilMs: Math.min(...dues), instances };
}

/**
 * Has the Pebble app ask Weather Enhanced for the weather.
 *
 * @param context Where each run reads from.
 * @param clock Reads the time now, normally `Date.now`.
 */
export function handleSource(context: ServeContext, clock: () => number = Date.now): void {
  context.pebble.registerSourceHandler(async (request, respond) => {
    const startMs = clock();

    try {
      respond.data(await weatherAnswer({ ...context, clock }, startMs, request ? request.properties : undefined));
    } catch (error) {
      console.log(`Weather Enhanced: the weather could not be served, ${error}`);
      respond.error('PLUGIN_UNAVAILABLE', String(error));
    }
  });
}
