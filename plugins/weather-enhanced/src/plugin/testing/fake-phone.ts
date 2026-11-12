/**
 * A stand-in phone for the plugin's specs: the plugin runtime, `localStorage`, and the weather
 * providers' sites, with no network.
 *
 * The Pebble app's Preferences plugin hands back the places it is given. Open-Meteo answers every
 * place in a batch with a reading whose days start on the place's midnight, and a place can be given
 * fewer days. OpenWeatherMap answers each place with a clear sky. Any site can be given an error
 * instead, and every request is recorded.
 */

import { SAVE_MESSAGE, SETTINGS_KEY } from '../../../paf/ts/plugin-app/settings';
import type { PluginPebble, SourceRequest, SourceResponder } from '../../../paf/ts/plugin-app/runtime';
import type { WeatherPlace } from '../../../paf/ts/plugin-app/weather';
import type { SourceEnvelope, SourceInstance } from '../../../paf/ts/plugin-sources/types';
import type { RequestFn } from '../../../paf/ts/pkjs/request';
import { SETTINGS_OPTIONS } from '../../settings';
import { handlePage } from '../page-bridge';
import { handleSource } from '../serve';

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

/** Thursday 12 November 2026, 15:00 UTC, 10:00 in Toronto. */
export const NOW_MS = Date.UTC(2026, 10, 12, 15, 0);

export const MINUTE_MS = 60 * 1000;

/** Toronto, five hours behind UTC in November. */
export const TORONTO: WeatherPlace = { key: 'toronto', name: 'Toronto', lat: 43.65, lon: -79.38, current: false };

/** London, on UTC in November. */
export const LONDON: WeatherPlace = { key: 'london', name: 'London', lat: 51.51, lon: -0.13, current: false };

/** What a site answers: an error, a body, or both. */
export type Reply = [string | null, unknown?];

/** How each site answers a request, by the URL asked. */
export interface Sites {
  /** Open-Meteo's answer, or undefined for the usual one, every place with ten days. */
  openMeteo?: (url: string) => Reply | undefined;
  owm?: (url: string) => Reply;
  weatherapi?: (url: string) => Reply;
}

/** The days each place's Open-Meteo answer holds, by latitude, 10 when left out. */
export type DaysByLatitude = Record<number, number>;

/** An Open-Meteo answer for one place, its days from the place's midnight before `nowMs`, on its offset. */
export function openMeteoPlace(nowMs: number, offsetSeconds: number, days = 10, temperature = 6.5): Record<string, unknown> {
  const nowSeconds = nowMs / 1000;
  const midnight = Math.floor((nowSeconds + offsetSeconds) / DAY_SECONDS) * DAY_SECONDS - offsetSeconds;
  const dayTimes = Array.from({ length: days }, (_, index) => midnight + (index - 1) * DAY_SECONDS);
  const hourTimes = Array.from({ length: 74 }, (_, index) => midnight + (index - 24) * HOUR_SECONDS);
  const each = (times: number[], value: number) => times.map(() => value);

  return {
    utc_offset_seconds: offsetSeconds,
    current: { time: nowSeconds - 300, temperature_2m: temperature, apparent_temperature: temperature - 2, weather_code: 3, is_day: 1, relative_humidity_2m: 70, wind_speed_10m: 12, wind_direction_10m: 270, uv_index: 1, pressure_msl: 1016, dew_point_2m: 1 },
    hourly: {
      time: hourTimes,
      temperature_2m: each(hourTimes, temperature),
      weather_code: each(hourTimes, 3),
      is_day: each(hourTimes, 1),
      pressure_msl: each(hourTimes, 1016),
    },
    daily: {
      time: dayTimes,
      temperature_2m_max: each(dayTimes, 9),
      temperature_2m_min: each(dayTimes, 2),
      weather_code: each(dayTimes, 3),
      precipitation_probability_max: each(dayTimes, 20),
      sunrise: dayTimes.map((day) => day + 7 * HOUR_SECONDS),
      sunset: dayTimes.map((day) => day + 17 * HOUR_SECONDS),
    },
  };
}

/** The latitudes a batched Open-Meteo request asks for, in order. */
function latitudesOf(url: string): number[] {
  const match = /[?&]latitude=([^&]*)/.exec(url);

  return match ? match[1].split(',').map(Number) : [];
}

/** Open-Meteo's answer to a batch, each place on Toronto's offset or UTC, with the days asked for each. */
export function openMeteoAnswer(url: string, nowMs: number, days: DaysByLatitude = {}, temperature = 6.5): unknown {
  const answers = latitudesOf(url).map((lat) => openMeteoPlace(nowMs, lat === TORONTO.lat ? -5 * HOUR_SECONDS : 0, days[lat] ?? 10, temperature));

  return answers.length === 1 ? answers[0] : answers;
}

/** OpenWeatherMap's answer for a clear sky. */
export function owmAnswer(nowMs: number, temperature = 4): unknown {
  return { cod: 200, dt: nowMs / 1000 - 120, timezone: 0, main: { temp: temperature, feels_like: temperature - 1, humidity: 60, pressure: 1020 }, weather: [{ id: 800, main: 'Clear', icon: '01d' }], wind: { speed: 3, deg: 200 } };
}

/** A request function that answers from the sites given and records every URL asked. */
export function fakeSites(sites: Sites, nowMs: () => number): { request: RequestFn; asked: string[] } {
  const asked: string[] = [];
  const request: RequestFn = (url, callback) => {
    asked.push(url);

    let reply: Reply | undefined;

    if (url.includes('open-meteo.com')) {
      reply = sites.openMeteo ? sites.openMeteo(url) : undefined;
      reply = reply || [null, openMeteoAnswer(url, nowMs())];
    } else if (url.includes('openweathermap.org')) {
      reply = sites.owm ? sites.owm(url) : [null, owmAnswer(nowMs())];
    } else if (url.includes('weatherapi.com')) {
      reply = sites.weatherapi ? sites.weatherapi(url) : ['http 500'];
    } else {
      reply = ['network error'];
    }

    callback(reply[0], reply[1] === undefined ? undefined : JSON.stringify(reply[1]));
  };

  return { request, asked };
}

/** The part of `localStorage` the plugin uses, held in memory. */
export function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { items: Map<string, string> } {
  const items = new Map<string, string>();

  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) };
}

/** The Preferences plugin's answer listing these places. */
function placesEnvelope(places: WeatherPlace[]): SourceEnvelope {
  return {
    instances: places.map((place): SourceInstance => ({
      instanceId: place.key,
      properties: { name: { shortText: { text: place.name } }, latitude: { numericValue: { value: place.lat } }, longitude: { numericValue: { value: place.lon } } },
    })),
  };
}

/** What the plugin answered a run with. */
export interface Served {
  data?: { validUntilMs?: number; instances: SourceInstance[] };
  error?: string;
}

/** A phone running the plugin, with the clock in the spec's hands. */
export interface FakePhone {
  storage: ReturnType<typeof memoryStorage>;
  asked: string[];
  /** Moves the clock on. */
  advance(ms: number): void;
  /** Sets the clock. */
  setNow(ms: number): void;
  /** Runs the plugin as the Pebble app would, for the properties named, or every one. */
  run(properties?: string[]): Promise<Served>;
  /** Saves settings from the page, as the wearer pressing Save. */
  save(settings: Record<string, unknown>): Promise<void>;
  /** Sends the plugin any message from the page, and hands back its reply. */
  send(message: unknown): Promise<unknown>;
}

/**
 * A phone with the plugin installed, these places in the Pebble app's weather list, and these
 * settings already saved.
 *
 * @param options The places, the saved settings, the secret keys, how each site answers, and when the clock starts.
 * @return The phone.
 */
export function fakePhone(options: { places?: WeatherPlace[]; settings?: Record<string, unknown>; keys?: Record<string, string>; sites?: Sites; nowMs?: number; clock?: () => number } = {}): FakePhone {
  let nowMs = options.nowMs ?? NOW_MS;
  const clock = options.clock || (() => nowMs);
  const storage = memoryStorage();
  const keys = new Map(Object.entries(options.keys || {}));
  const { request, asked } = fakeSites(options.sites || {}, () => nowMs);
  let sourceHandler: ((request: SourceRequest, respond: SourceResponder) => void | Promise<void>) | null = null;
  let configHandler: ((message: unknown, respond: (reply: unknown) => void) => void | Promise<void>) | null = null;

  storage.setItem(SETTINGS_KEY, JSON.stringify(options.settings || {}));

  const pebble = {
    registerSourceHandler: (handler: typeof sourceHandler) => void (sourceHandler = handler),
    registerConfigHandler: (handler: typeof configHandler) => void (configHandler = handler),
    subscribeSource: () => undefined,
    refreshSources: () => undefined,
    readSource: async (asking: SourceRequest) => (asking.item === 'weather_location' ? placesEnvelope(options.places || [TORONTO]) : { instances: [] }),
    secureStorage: {
      getItem: async (key: string) => keys.get(key) ?? null,
      setItem: async (key: string, value: string) => void keys.set(key, value),
      removeItem: async (key: string) => void keys.delete(key),
    },
  } as unknown as PluginPebble;

  handlePage(SETTINGS_OPTIONS, pebble, storage);
  handleSource({ pebble, storage, request }, clock);

  return {
    storage,
    asked,
    advance: (ms) => void (nowMs += ms),
    setNow: (ms) => void (nowMs = ms),
    run: async (properties) => {
      const served: Served = {};

      await sourceHandler!({ category: 'weather', item: 'location', properties }, {
        data: (envelope) => void (served.data = envelope),
        error: (code) => void (served.error = code),
      });

      return served;
    },
    send: async (message) => {
      let reply: unknown = null;

      await configHandler!(message, (answer) => void (reply = answer));

      return reply;
    },
    save: async (settings) => {
      await configHandler!({ type: SAVE_MESSAGE, settings }, () => undefined);
    },
  };
}

/** The temperature an instance carries, or undefined. */
export function temperatureOf(instance: SourceInstance | undefined): number | undefined {
  return instance?.properties?.temperature?.numericValue?.value;
}

/** The full name of the provider an instance says its reading came from. */
export function sourceOf(instance: SourceInstance | undefined): string | undefined {
  return instance?.properties?.source?.longText?.text;
}
