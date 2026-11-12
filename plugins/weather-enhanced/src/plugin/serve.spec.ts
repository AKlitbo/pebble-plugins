/**
 * Specs for how Weather Enhanced answers the Pebble app.
 *
 * The Pebble app runs the plugin every few minutes, and becoming the preferred weather source makes
 * its answer the watch's own Weather app too. So what is worth pinning is what each run spends and
 * what it serves when a provider cannot answer. A copy that is fresh must spend nothing, and one made
 * with another key must never be served. A provider that turned a fetch away must be left alone until
 * it can answer again. A failed place must fall back in the order the wearer was promised, and a place
 * with nothing worth serving must be left to the Pebble app rather than sent half filled. The ledger
 * must hold exactly what went out, or the free plans run dry or sit unused.
 */

import { describe, test, expect } from 'vitest';
import { FETCH_FAILED } from '../../paf/ts/plugin-app/request';
import { keyPrint, readStamps, saveStamps } from '../../paf/ts/quota/ledger';
import type { Stamp } from '../../paf/ts/quota/ledger';
import { READING_WEIGHT } from '../../paf/ts/weather/providers/openmeteo';
import { LEDGER_KEY, QUOTA_PLANS } from '../limits';
import type { ProviderId } from '../settings';
import { STOPS_KEY, setStop } from './gates';
import { FAILOVER_STARTS_BEFORE_MS } from './serve';
import { LONDON, MINUTE_MS, NOW_MS, TORONTO, fakePhone, openMeteoAnswer, owmAnswer, sourceOf, temperatureOf } from './testing/fake-phone';
import type { FakePhone } from './testing/fake-phone';

const OWM = { PROVIDER: 'owm' };

// WeatherAPI.com's answer once a key's month of calls is spent
const MONTH_SPENT = ['http 403', { error: { code: 2007, message: 'API key has exceeded calls per month quota.' } }];
const KEY_A = { OWM_KEY: 'key-a' };
const HOUR_MS = 60 * MINUTE_MS;

/** How many requests went to a site. */
function sentTo(asked: string[], site: string): number {
  return asked.filter((url) => url.includes(site)).length;
}

/** The stops the phone keeps, by provider, with each one's status. */
function stopsOf(phone: FakePhone): Record<string, string> {
  const stops = JSON.parse(phone.storage.getItem(STOPS_KEY) || '{}');

  return Object.fromEntries(Object.keys(stops).map((provider) => [provider, stops[provider].status]));
}

/** Fills a provider's ledger with calls sent a while ago, weighing this much in all. */
function spend(phone: FakePhone, provider: ProviderId, print: string, calls: number, agoMs: number): void {
  const stamps: Stamp[] = [[NOW_MS - agoMs, calls]];

  saveStamps(phone.storage, LEDGER_KEY, provider, print, stamps, QUOTA_PLANS[provider], NOW_MS);
}

describe('copies', () => {
  /** A run that fetches while the copy is fresh spends a call every few minutes for weather nobody asked to change. */
  test('serves a fresh copy with nothing fetched', async () => {
    const phone = fakePhone();

    await phone.run();
    phone.advance(10 * MINUTE_MS);

    const result = await phone.run();

    expect([phone.asked.length, temperatureOf(result.data?.instances[0])]).toEqual([1, 6.5]);
  });

  /** A copy that has reached the Refresh Interval is the one thing that should start a fetch. */
  test('fetches a place again once its copy reaches the Refresh Interval', async () => {
    const phone = fakePhone({ settings: { REFRESH: '30' } });

    await phone.run();
    phone.advance(30 * MINUTE_MS);

    await phone.run();

    expect(phone.asked.length).toBe(2);
  });

  /** A copy fetched with the old key would show a reading the new key never paid for, and hide a key that does not work. */
  test('drops the copy when the key changes', async () => {
    const phone = fakePhone({ settings: OWM, keys: KEY_A });

    await phone.run();
    await phone.save({ ...OWM, OWM_KEY: 'key-b' });

    await phone.run();

    expect(sentTo(phone.asked, 'openweathermap.org')).toBe(2);
  });

  /** Switching provider has to show that provider's weather straight away, not the last one's until the copy ages. */
  test('drops the copy when the provider changes', async () => {
    const phone = fakePhone({ keys: KEY_A });

    await phone.run();
    await phone.save(OWM);

    await phone.run();

    expect(sentTo(phone.asked, 'openweathermap.org')).toBe(1);
  });
});

describe('stops', () => {
  /** WeatherAPI.com answers nothing more once its month is spent, so asking before the 1st only spends a refusal. */
  test('holds WeatherAPI.com after its month is spent until the 1st of the month', async () => {
    // Open-Meteo is down as well, so no copy is kept and every run past the Refresh Interval is due
    const phone = fakePhone({ settings: { PROVIDER: 'weatherapi' }, keys: { WEATHERAPI_KEY: 'key-a' }, sites: { openMeteo: () => ['http 500'], weatherapi: () => MONTH_SPENT as [string, unknown] } });

    await phone.run();
    phone.setNow(Date.UTC(2026, 10, 30, 23, 0));
    await phone.run();
    const held = sentTo(phone.asked, 'weatherapi.com');

    phone.setNow(Date.UTC(2026, 11, 1, 0, 1));

    await phone.run();

    expect([held, sentTo(phone.asked, 'weatherapi.com')]).toEqual([1, 2]);
  });

  /** A 429 that names no limit may only have been a burst, so holding WeatherAPI.com to the 1st would lose it for weeks. */
  test('asks WeatherAPI.com again an hour after a bare rate limit', async () => {
    const phone = fakePhone({ settings: { PROVIDER: 'weatherapi', REFRESH: '15' }, keys: { WEATHERAPI_KEY: 'key-a' }, sites: { openMeteo: () => ['http 500'], weatherapi: () => ['http 429'] } });

    await phone.run();
    phone.setNow(NOW_MS + 59 * MINUTE_MS);
    await phone.run();
    const held = sentTo(phone.asked, 'weatherapi.com');

    // the Open-Meteo failover a minute ago is its own ask, so the next one waits out the Refresh Interval
    phone.setNow(NOW_MS + 75 * MINUTE_MS);

    await phone.run();

    expect([held, sentTo(phone.asked, 'weatherapi.com')]).toEqual([1, 2]);
  });

  /** A bad key asked every run spends the wearer's calls on refusals, and the wearer fixes it by saving. */
  test('holds a provider after a bad key until the wearer saves', async () => {
    const phone = fakePhone({ settings: { ...OWM, REFRESH: '15' }, keys: KEY_A, sites: { owm: () => ['http 401'] } });

    await phone.run();
    phone.advance(20 * MINUTE_MS);
    await phone.run();
    const held = sentTo(phone.asked, 'openweathermap.org');

    await phone.save({ ...OWM, REFRESH: '15' });
    phone.advance(16 * MINUTE_MS);

    await phone.run();

    expect([held, sentTo(phone.asked, 'openweathermap.org')]).toEqual([1, 2]);
  });

  /** A save the plugin turned away changed nothing, so the key it refused is still the one in use. */
  test('keeps a bad key stop through a save the plugin refused', async () => {
    const phone = fakePhone({ settings: OWM, keys: KEY_A, sites: { owm: () => ['http 401'] } });

    await phone.run();
    await phone.send({ type: 'paf-settings-save', settings: 'not settings' });

    const result = stopsOf(phone);

    expect(result).toEqual({ owm: 'INVALID KEY' });
  });

  /**
   * A rate limit is the provider's own answer, so a save asking again would only meet it again. Turning
   * Paid Plan on or off changes the limits the stop held the key to, so that save lifts it.
   */
  test('keeps a rate limit stop through a save, unless the save switches Paid Plan', async () => {
    const phone = fakePhone({ settings: OWM, keys: KEY_A, sites: { owm: () => ['http 429'] } });

    await phone.run();
    await phone.save(OWM);
    const kept = stopsOf(phone);

    await phone.save({ ...OWM, OWM_PAID: true });

    const result = [kept, stopsOf(phone)];

    expect(result).toEqual([{ owm: 'RATE LIMIT' }, {}]);
  });

  /** A key the wearer swapped in has never been refused, so the old key's stop must not hold it. */
  test("asks a new key straight away, whatever the old key's stop", async () => {
    const phone = fakePhone({ settings: OWM, keys: KEY_A, sites: { owm: (url) => (url.includes('key-a') ? ['http 429'] : [null, owmAnswer(NOW_MS)]) } });

    await phone.run();
    await phone.save({ ...OWM, OWM_KEY: 'key-b' });

    const result = await phone.run();

    expect([sentTo(phone.asked, 'openweathermap.org'), sourceOf(result.data?.instances[0])]).toEqual([2, 'OpenWeatherMap']);
  });

  /** A key can be fixed on the provider's side with no save, and a stop that never lifts would leave it unused for good. */
  test('asks a provider again a day after a bad key with no save', async () => {
    const phone = fakePhone({ settings: { ...OWM, REFRESH: '15' }, keys: KEY_A, sites: { owm: () => ['http 401'] } });

    await phone.run();
    phone.setNow(NOW_MS + 24 * HOUR_MS - MINUTE_MS);
    await phone.run();
    const held = sentTo(phone.asked, 'openweathermap.org');

    // the Open-Meteo failover a minute ago is its own ask, so the next one waits out the Refresh Interval
    phone.setNow(NOW_MS + 24 * HOUR_MS + 15 * MINUTE_MS);

    await phone.run();

    expect([held, sentTo(phone.asked, 'openweathermap.org')]).toEqual([1, 2]);
  });

  /** One place's call turned away can be that place's trouble, while the others show the key works. */
  test('sets no stop when only one place of several came back with a bad key', async () => {
    const phone = fakePhone({ places: [TORONTO, LONDON], settings: OWM, keys: KEY_A, sites: { owm: (url) => (url.includes(`lat=${TORONTO.lat}`) ? ['http 401'] : [null, owmAnswer(NOW_MS)]) } });

    await phone.run();

    const result = stopsOf(phone);

    expect(result).toEqual({});
  });
});

describe('the failover', () => {
  /** The wearer picked the provider, so a recent reading from it beats switching to Open-Meteo. */
  test("serves the place's copy while it is under three Refresh Intervals old", async () => {
    let owmDown = false;
    const phone = fakePhone({ settings: { ...OWM, REFRESH: '15' }, keys: KEY_A, sites: { owm: () => (owmDown ? ['http 500'] : [null, { cod: 200, dt: NOW_MS / 1000, timezone: 0, main: { temp: 4 }, weather: [{ id: 800, main: 'Clear', icon: '01d' }] }]) } });

    await phone.run();
    owmDown = true;
    phone.advance(40 * MINUTE_MS);

    const result = await phone.run();

    expect([sourceOf(result.data?.instances[0]), temperatureOf(result.data?.instances[0])]).toEqual(['OpenWeatherMap', 4]);
  });

  /** Open-Meteo's half of the failed fetch is a reading already paid for, so a second request would spend it twice. */
  test('serves the Open-Meteo reading the failed fetch carried, with no second request', async () => {
    const phone = fakePhone({ settings: OWM, keys: KEY_A, sites: { owm: () => ['http 500'] } });

    const result = await phone.run();

    expect([sourceOf(result.data?.instances[0]), sentTo(phone.asked, 'open-meteo.com')]).toEqual(['Open-Meteo', 1]);
  });

  /** A held provider sends nothing, so Open-Meteo asked on its own is the only weather left for the place. */
  test('asks Open-Meteo on its own when the provider sent nothing', async () => {
    const phone = fakePhone({ settings: { PROVIDER: 'owm' }, keys: {} });

    const result = await phone.run();

    expect([sourceOf(result.data?.instances[0]), sentTo(phone.asked, 'open-meteo.com')]).toEqual(['Open-Meteo', 1]);
  });

  /** Three Refresh Intervals is the promise, so past it the newer Open-Meteo reading wins over the provider's old one. */
  test('stops serving the copy once it is three Refresh Intervals old', async () => {
    let owmDown = false;
    const phone = fakePhone({ settings: { ...OWM, REFRESH: '15' }, keys: KEY_A, sites: { owm: () => (owmDown ? ['http 500'] : [null, owmAnswer(NOW_MS)]) } });

    await phone.run();
    owmDown = true;
    phone.advance(45 * MINUTE_MS);

    const result = await phone.run();

    expect(sourceOf(result.data?.instances[0])).toBe('Open-Meteo');
  });

  /**
   * A failover reading kept as the copy would be served for three intervals ahead of newer Open-Meteo
   * readings, up to six hours old at a two hour interval. Open-Meteo's temperature here climbs a degree
   * a minute, so the reading served says when it was fetched.
   */
  test('serves the newer Open-Meteo reading over a copy that was itself a failover', async () => {
    let now = NOW_MS;
    const phone = fakePhone({ settings: { ...OWM, REFRESH: '30' }, keys: KEY_A, sites: { owm: () => ['http 500'], openMeteo: (url) => [null, openMeteoAnswer(url, now, {}, (now - NOW_MS) / MINUTE_MS)] } });

    await phone.run();
    now += 30 * MINUTE_MS;
    phone.setNow(now);

    const result = await phone.run();

    expect(temperatureOf(result.data?.instances[0])).toBe(30);
  });

  /**
   * The Pebble app runs each subscriber every 15 minutes whatever the answer says, so a provider down
   * for hours would be asked for every place on every run if a failed ask were forgotten.
   */
  test('asks a provider that failed no sooner than the Refresh Interval', async () => {
    let owmDown = false;
    const phone = fakePhone({ places: [TORONTO, LONDON], settings: { ...OWM, REFRESH: '30' }, keys: KEY_A, sites: { owm: () => (owmDown ? ['http 500'] : [null, owmAnswer(NOW_MS)]) } });

    await phone.run();
    owmDown = true;
    phone.advance(30 * MINUTE_MS);
    await phone.run();
    phone.advance(15 * MINUTE_MS);
    await phone.run();
    phone.advance(10 * MINUTE_MS);
    await phone.run();

    const result = [sentTo(phone.asked, 'openweathermap.org'), sentTo(phone.asked, 'open-meteo.com')];

    expect(result).toEqual([4, 2]);
  });

  /** Open-Meteo already failed beside the provider in this run, so asking it again on its own only spends a call. */
  test('asks Open-Meteo on its own no second time when its half of the fetch failed', async () => {
    const phone = fakePhone({ places: [TORONTO, LONDON], settings: OWM, keys: KEY_A, sites: { owm: () => ['http 500'], openMeteo: () => ['http 502'] } });

    await phone.run();

    const result = sentTo(phone.asked, 'open-meteo.com');

    expect(result).toBe(1);
  });

  /** A failover reading not kept is fetched again on the next run, and with Open-Meteo gone the place has nothing. */
  test('keeps a failover reading as the place copy', async () => {
    let openMeteoDown = false;
    const phone = fakePhone({ settings: OWM, keys: {}, sites: { openMeteo: (url) => (openMeteoDown ? ['http 500'] : [null, openMeteoAnswer(url, NOW_MS)]) } });

    await phone.run();
    openMeteoDown = true;
    phone.advance(5 * MINUTE_MS);

    const result = await phone.run();

    expect([sourceOf(result.data?.instances[0]), sentTo(phone.asked, 'open-meteo.com')]).toEqual(['Open-Meteo', 1]);
  });

  /** Open-Meteo asked on its own still counts against its plan, and a rate limit it gave still holds it. */
  test('holds the lone Open-Meteo failover to its stop', async () => {
    const phone = fakePhone({ settings: OWM, keys: {} });

    setStop(phone.storage, 'openmeteo', '', 'RATE LIMIT', NOW_MS, false);

    const result = await phone.run();

    expect([result.error, sentTo(phone.asked, 'open-meteo.com')]).toEqual(['PLUGIN_UNAVAILABLE', 0]);
  });

  /** A keyed provider's fetch always asks Open-Meteo for the series too, so a rate limited Open-Meteo holds the provider as well. */
  test("holds a keyed provider's fetch while Open-Meteo is stopped", async () => {
    const phone = fakePhone({ settings: OWM, keys: KEY_A });

    setStop(phone.storage, 'openmeteo', '', 'RATE LIMIT', NOW_MS, false);

    await phone.run();

    const result = [sentTo(phone.asked, 'openweathermap.org'), sentTo(phone.asked, 'open-meteo.com')];

    expect(result).toEqual([0, 0]);
  });

  /** A fetch that cannot finish before the Pebble app ends the run spends a call and serves nothing. */
  test('starts no Open-Meteo failover once the run is out of time', async () => {
    let nowMs = NOW_MS;
    const phone = fakePhone({ settings: { PROVIDER: 'owm' }, clock: () => (nowMs += FAILOVER_STARTS_BEFORE_MS) });

    const result = await phone.run();

    expect([result.error, sentTo(phone.asked, 'open-meteo.com')]).toEqual(['PLUGIN_UNAVAILABLE', 0]);
  });
});

describe('what is served', () => {
  /** More than five places would spend Open-Meteo past the plan's weight, and First Location Only has to mean one. */
  test.each([
    ['first', 1],
    ['all', 5],
  ])('serves the places Places to Fetch %s asks for', async (setting, count) => {
    const places = Array.from({ length: 6 }, (_, index) => ({ ...LONDON, key: `place-${index}`, lat: LONDON.lat + index / 100 }));
    const phone = fakePhone({ places, settings: { PLACES: setting } });

    const result = await phone.run();

    expect(result.data?.instances.map((instance) => instance.instanceId)).toEqual(places.slice(0, count).map((place) => place.key));
  });

  /** A face naming the series it shows should not carry every other series across to the phone. */
  test('sends only the series a request names', async () => {
    const phone = fakePhone();

    const result = await phone.run(['temperature', 'hourly_temperature']);

    expect(Object.keys(result.data?.instances[0].properties || {}).filter((name) => /^(hourly|daily)_/.test(name))).toEqual(['hourly_temperature']);
  });

  /** The Pebble app's own Weather app names no properties and needs the daily series, so a request with no list gets them all. */
  test('sends every series to a request that names none', async () => {
    const phone = fakePhone();

    const result = await phone.run(undefined);

    expect(Object.keys(result.data?.instances[0].properties || {})).toEqual(expect.arrayContaining(['daily_high', 'daily_sunrise', 'hourly_temperature']));
  });

  /** A face that shows where the weather is for reads the place's coordinates from the plugin, since the Pebble app's list is not its to read. */
  test("sends each place's coordinates from the Pebble app's weather list to a face that asks for them", async () => {
    const phone = fakePhone({ places: [TORONTO, LONDON] });

    const reply = await phone.run(['latitude', 'longitude']);
    const result = reply.data?.instances.map((instance) => [instance.properties?.latitude?.numericValue?.value, instance.properties?.longitude?.numericValue?.value]);

    expect(result).toEqual([
      [43.65, -79.38],
      [51.51, -0.13],
    ]);
  });

  /** The Pebble app's own Weather app names no properties, and the wearer's places should not travel anywhere nothing asked for them. */
  test('sends no coordinates to a request that does not name them', async () => {
    const phone = fakePhone({ places: [TORONTO, LONDON] });

    const reply = await phone.run();
    const result = reply.data?.instances.map((instance) => ['latitude', 'longitude'].filter((name) => instance.properties?.[name]));

    expect(result).toEqual([[], []]);
  });

  /** The Pebble app drops the watch's Weather app for a place without tomorrow, so it has to come from its backend instead. */
  test('leaves out a place whose reading does not hold two days', async () => {
    const phone = fakePhone({ places: [TORONTO, LONDON], sites: { openMeteo: (url) => [null, openMeteoAnswer(url, NOW_MS, { [LONDON.lat]: 2 })] } });

    const result = await phone.run();

    expect(result.data?.instances.map((instance) => instance.instanceId)).toEqual(['toronto']);
  });

  /** Half an answer would leave the watch's Weather app with gaps where the Pebble app would have filled every place. */
  test('answers PLUGIN_UNAVAILABLE when no place can be served', async () => {
    const phone = fakePhone({ places: [TORONTO, LONDON], sites: { openMeteo: () => ['http 500'] } });

    const result = await phone.run();

    expect(result.error).toBe('PLUGIN_UNAVAILABLE');
  });

  /** The Pebble app reads again when the answer runs out, so a later time would leave the older place's weather stale. */
  test("says the answer is good until the oldest place's copy is due", async () => {
    const phone = fakePhone({ places: [TORONTO, LONDON], settings: { REFRESH: '30', PLACES: 'first' } });

    await phone.run();
    await phone.save({ REFRESH: '30', PLACES: 'all' });
    phone.advance(10 * MINUTE_MS);

    const result = await phone.run();

    expect([result.data?.instances.length, result.data?.validUntilMs]).toEqual([2, NOW_MS + 30 * MINUTE_MS]);
  });

  /** A Refresh Interval the page never offered, such as 1 or a negative, would fetch on every run. */
  test.each(['1', '-30', 'abc'])('takes a Refresh Interval of %s as the default 30 minutes', async (refresh) => {
    const phone = fakePhone({ settings: { REFRESH: refresh } });

    const result = await phone.run();

    expect(result.data?.validUntilMs).toBe(NOW_MS + 30 * MINUTE_MS);
  });

  /** A clock set back makes the copy look younger than nothing, which is no reason to keep serving it without a fetch. */
  test('fetches again when the clock is set back past the copy', async () => {
    const phone = fakePhone();

    await phone.run();
    phone.setNow(NOW_MS - 10 * MINUTE_MS);

    await phone.run();

    expect(phone.asked.length).toBe(2);
  });
});

describe('the ledger', () => {
  /**
   * A stamp for a call never sent spends a free plan that was never used, and a call with no stamp lets
   * the plugin run past it. OpenWeatherMap counts one call a place, and Open-Meteo each place in its
   * batch at its weight.
   */
  test('stamps each provider exactly once for each place a request asked for', async () => {
    const phone = fakePhone({ places: [TORONTO, LONDON], settings: OWM, keys: KEY_A });

    await phone.run();

    const result = [readStamps(phone.storage, LEDGER_KEY, 'owm', keyPrint('key-a')), readStamps(phone.storage, LEDGER_KEY, 'openmeteo', '')];

    expect(result).toEqual([[NOW_MS, NOW_MS], [[NOW_MS, READING_WEIGHT], [NOW_MS, READING_WEIGHT]]]);
  });

  /** Open-Meteo counts each place at its full weight, so a ledger with room for three light calls has none for one place. */
  test('sends nothing for a place the Open-Meteo ledger has no room for at its weight', async () => {
    const phone = fakePhone();

    // two hours back is inside the rolling day and outside the hour, so only the day's 10,000 holds it
    spend(phone, 'openmeteo', '', 9997, 2 * HOUR_MS);

    const result = await phone.run();

    expect([result.error, phone.asked.length]).toEqual(['PLUGIN_UNAVAILABLE', 0]);
  });

  /** A paid key is held to no free plan, so the ledger must neither stop it nor count it. */
  test('fetches past a full ledger and stamps nothing on Paid Plan', async () => {
    const phone = fakePhone({ settings: { ...OWM, OWM_PAID: true }, keys: KEY_A });

    spend(phone, 'owm', keyPrint('key-a'), 60, 1000);

    await phone.run();

    const result = [sentTo(phone.asked, 'openweathermap.org'), readStamps(phone.storage, LEDGER_KEY, 'owm', keyPrint('key-a')).length];

    expect(result).toEqual([1, 1]);
  });

  /** The Pebble app can end a run while a request is out, so a stamp saved only on the answer would be lost. */
  test('has the stamp in storage before the request answers', async () => {
    let seen: Stamp[] = [];
    let phone: FakePhone | null = null;

    phone = fakePhone({ settings: OWM, keys: KEY_A, sites: { owm: () => ((seen = readStamps(phone!.storage, LEDGER_KEY, 'owm', keyPrint('key-a'))), [null, owmAnswer(NOW_MS)]) } });

    await phone.run();

    expect(seen).toEqual([NOW_MS]);
  });

  /** A provider that answered with an error still counted the call, so the stamp stays. */
  test('keeps the stamp of a request the host answered with an error', async () => {
    const phone = fakePhone({ settings: OWM, keys: KEY_A, sites: { owm: () => ['http 500'] } });

    await phone.run();

    const result = readStamps(phone.storage, LEDGER_KEY, 'owm', keyPrint('key-a'));

    expect(result).toEqual([NOW_MS]);
  });

  /** A request that timed out or lost its answer may still have reached the provider, which counted it. */
  test.each(['timeout', FETCH_FAILED])('keeps the stamp of a request that answered %s', async (error) => {
    const phone = fakePhone({ settings: OWM, keys: KEY_A, sites: { owm: () => [error] } });

    await phone.run();

    const result = readStamps(phone.storage, LEDGER_KEY, 'owm', keyPrint('key-a'));

    expect(result).toEqual([NOW_MS]);
  });

  /** A call that never left the phone cost nothing, so its stamp has to come back off. */
  test('takes back the stamp of a request that never left the phone', async () => {
    const phone = fakePhone({ settings: OWM, keys: KEY_A, sites: { owm: () => ['network error'] } });

    await phone.run();

    const result = readStamps(phone.storage, LEDGER_KEY, 'owm', keyPrint('key-a'));

    expect(result).toEqual([]);
  });
});
