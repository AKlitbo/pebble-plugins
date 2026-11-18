/**
 * Specs for the wearer's place list laid over the Pebble app's weather list.
 *
 * Every face reading Weather Enhanced gets the places this picks, so what is worth pinning is the
 * order and the switches. An empty list has to serve exactly what the plugin served before it had a
 * list, the Pebble app's places in its order, and a saved First Location Only has to keep meaning one
 * place. A place the wearer never saw on the page has to reach faces anyway, and a saved list the
 * plugin cannot read has to cost only the entries that are wrong. A place added on the page goes out
 * under its own id with its own coordinates wherever it sits in the order, and Pebble App Places off
 * has to leave only the added places, still held to five. A place's copy and last ask go only once the
 * wearer switched it off or removed it, never because one run missed it.
 */

import { describe, test, expect } from 'vitest';
import type { ListedWeatherPlace, WeatherPlace } from '../../paf/ts/plugin-app/weather';
import { arrangePlaces, planPlaces, readPlaceList } from './place-list';

/** A place in the Pebble app's weather list, by key. */
function place(key: string): WeatherPlace {
  return { key, name: key, lat: 45, lon: -75, current: false };
}

/** The Pebble app's places, in its order. */
const APP = [place('home'), place('work'), place('cabin')];

/** An added place as the page saves it. */
function added(id: string, on = true): Record<string, unknown> {
  return { id, on, name: 'Cottage', lat: 45.1234, lon: -79.5678 };
}

/** A saved list in the form the page writes it. */
function saved(entries: Array<[string, boolean]>): string {
  return JSON.stringify(entries.map(([id, on]) => ({ id, app: true, on })));
}

/** The keys of the places a run serves. */
function served(places: WeatherPlace[], settings: Record<string, unknown>): string[] {
  return planPlaces(located(places), settings).serve.map((each) => each.key);
}

/** Places as the framework lists them, every one with coordinates. */
function located(places: WeatherPlace[]): ListedWeatherPlace[] {
  return places.map((each) => ({ ...each, located: true }));
}

/** A place in the Pebble app's list with no fix, as the current location can be. */
function noFix(key: string): ListedWeatherPlace {
  return { key, name: '', current: true, located: false };
}

describe('readPlaceList', () => {
  /** A broken save handed to the run as a list would throw on every run and serve nothing. */
  test.each([['not json'], ['{"id":"home"}'], [42], [undefined]])('reads %s as no list', (value) => {
    const result = readPlaceList(value);

    expect(result).toEqual([]);
  });

  /** One bad entry, such as one a later version writes, must not cost the wearer the rest of their order. */
  test('keeps the entries that read right and drops the rest', () => {
    const value = JSON.stringify([
      { id: 'home', app: true, on: true },
      { id: 'own-k3j9q2', on: true, name: 'Cottage', lat: 45.1234, lon: -79.5678 },
      { id: '', app: true, on: true },
      { id: 'x'.repeat(257), app: true, on: true },
      null,
      { id: 'cabin', app: true, on: false },
    ]);

    const result = readPlaceList(value);

    expect(result).toEqual([
      { id: 'home', app: true, on: true },
      { id: 'own-k3j9q2', on: true, name: 'Cottage', lat: 45.1234, lon: -79.5678 },
      { id: 'cabin', app: true, on: false },
    ]);
  });

  /** A Pebble app key past the old cap of 64 was dropped, so that place fell to the bottom and came back on after every run. */
  test('keeps an entry whose key runs to 256 characters', () => {
    const result = readPlaceList(saved([['x'.repeat(256), false]]));

    expect(result).toEqual([{ id: 'x'.repeat(256), app: true, on: false }]);
  });

  /** An entry with a switch that does not read was dropped, so its place lost its spot in the order and fell to the bottom. */
  test('reads a switch that is not true or false as on, keeping the entry in its place', () => {
    const value = JSON.stringify([{ id: 'work', app: true, on: 'yes' }, { ...added('own-a'), on: 'true' }, { id: 'home', app: true }]);

    const result = readPlaceList(value).map((entry) => [entry.id, entry.on]);

    expect(result).toEqual([
      ['work', true],
      ['own-a', true],
      ['home', true],
    ]);
  });

  /**
   * An added place is fetched by its coordinates alone, so one with no name, no id of its own, or
   * coordinates off the globe would spend a fetch on nothing a face could show.
   */
  test.each([
    ['a name of only spaces', { ...added('own-a'), name: '  ' }],
    ['an id without its prefix', added('cottage')],
    ['a latitude past the pole', { ...added('own-a'), lat: 91 }],
    ['a longitude given as text', { ...added('own-a'), lon: '-79.5' }],
  ])('drops an added place with %s', (_label, entry) => {
    const result = readPlaceList(JSON.stringify([entry]));

    expect(result).toEqual([]);
  });

  /** A coordinate saved finer than four decimals would serve a place a hair from the one the page showed. */
  test('rounds an added place to four decimals and trims its name', () => {
    const result = readPlaceList(JSON.stringify([{ id: 'own-a', on: true, name: '  Cottage  ', lat: 45.123456, lon: -79.567849 }]));

    expect(result).toEqual([{ id: 'own-a', on: true, name: 'Cottage', lat: 45.1235, lon: -79.5678 }]);
  });

  /** The page allows five added places, so a list holding more was not written by it and must not grow the fetch. */
  test('keeps only the first five added places', () => {
    const value = JSON.stringify(Array.from({ length: 7 }, (_, index) => added(`own-${index}`)));

    const result = readPlaceList(value).map((entry) => entry.id);

    expect(result).toEqual(['own-0', 'own-1', 'own-2', 'own-3', 'own-4']);
  });

  /**
   * The cut came before the bad entries were dropped, so junk at the head of a list pushed the real
   * entries past it, and those places came back on at the bottom.
   */
  test('cuts the list by the entries it keeps, not by what it was handed', () => {
    const junk = Array.from({ length: 25 }, () => ({ id: '' }));
    const value = JSON.stringify([...junk, { id: 'home', app: true, on: false }]);

    const result = readPlaceList(value);

    expect(result).toEqual([{ id: 'home', app: true, on: false }]);
  });

  /** A key listed twice would serve the same place twice and spend a fetch on it. */
  test('takes only the first entry for a key', () => {
    const result = readPlaceList(saved([['home', false], ['home', true]]));

    expect(result).toEqual([{ id: 'home', app: true, on: false }]);
  });
});

describe('what planPlaces serves', () => {
  /** A wearer who never opened the page must keep getting the Pebble app's places as before. */
  test("serves the Pebble app's places in its order with nothing saved", () => {
    const result = served(APP, { PLACE_LIST: '[]' });

    expect(result).toEqual(['home', 'work', 'cabin']);
  });

  /** First Location Only from before the list must not turn into every place on the update. */
  test('serves only the first place for a saved First Location Only', () => {
    const result = served(APP, { PLACE_LIST: '[]', PLACES: 'first' });

    expect(result).toEqual(['home']);
  });

  /**
   * A list holding only added places says nothing about the Pebble app's places. Ending First Location
   * Only there switched every Pebble app place on, up to five, once the wearer added one place.
   */
  test('keeps First Location Only for the Pebble app places while the list holds only added places', () => {
    const result = served(APP, { PLACE_LIST: JSON.stringify([added('own-a')]), PLACES: 'first' });

    expect(result).toEqual(['own-a', 'home']);
  });

  /** Once the wearer saves the list, it is the whole answer and the old setting has no say. */
  test('leaves First Location Only out once a list is saved', () => {
    const result = served(APP, { PLACE_LIST: saved([['work', true], ['home', true]]), PLACES: 'first' });

    expect(result).toEqual(['work', 'home', 'cabin']);
  });

  /** A face showing one place shows the top one, so the wearer's order has to be the order served. */
  test("serves the list's order and leaves out a place switched off", () => {
    const result = served(APP, { PLACE_LIST: saved([['cabin', true], ['home', false], ['work', true]]) });

    expect(result).toEqual(['cabin', 'work']);
  });

  /** A place added in the Pebble app since the last save would otherwise never reach a face until the page was opened. */
  test('puts a place the list does not mention after the listed ones, switched on', () => {
    const result = served(APP, { PLACE_LIST: saved([['work', true], ['home', false]]) });

    expect(result).toEqual(['work', 'cabin']);
  });

  /** A place deleted in the Pebble app, or a current location with no fix this run, must not hold its slot empty. */
  test('skips a listed place this read does not have', () => {
    const result = served(APP, { PLACE_LIST: saved([['gone', true], ['cabin', true]]) });

    expect(result).toEqual(['cabin', 'home', 'work']);
  });

  /** More than five places would spend Open-Meteo past the weight the README counts on. */
  test('serves at most five places', () => {
    const places = Array.from({ length: 7 }, (_, index) => place(`place-${index}`));

    const result = served(places, {});

    expect(result).toEqual(['place-0', 'place-1', 'place-2', 'place-3', 'place-4']);
  });

  /** A face showing one place shows the top one, so an added place moved to the top has to be served first, under its own id. */
  test('serves an added place where the list puts it, with its own name and coordinates', () => {
    const result = planPlaces(located(APP), { PLACE_LIST: JSON.stringify([added('own-k3j9q2'), { id: 'home', app: true, on: true }]) }).serve.slice(0, 2);

    expect(result).toEqual([
      { key: 'own-k3j9q2', name: 'Cottage', lat: 45.1234, lon: -79.5678, current: false },
      place('home'),
    ]);
  });

  /** Pebble App Places off is how a wearer serves only their own places, so a Pebble app place left in would still reach every face. */
  test('leaves out every Pebble app place while Pebble App Places is off, listed or not', () => {
    const result = served(APP, { USE_APP_PLACES: false, PLACE_LIST: JSON.stringify([{ id: 'home', app: true, on: true }, added('own-a'), added('own-b', false), added('own-c')]) });

    expect(result).toEqual(['own-a', 'own-c']);
  });

  /** Added places with the Pebble app's on top would spend past the weight the README counts on. */
  test('holds added places and Pebble app places together to five', () => {
    const list = [added('own-a'), added('own-b'), added('own-c'), added('own-d')];

    const result = served(APP, { PLACE_LIST: JSON.stringify(list) });

    expect(result).toEqual(['own-a', 'own-b', 'own-c', 'own-d', 'home']);
  });

  /** A refused read leaves the run no Pebble app places, and the wearer's own places must still reach faces. */
  test('serves the added places when the read gave no Pebble app places', () => {
    const result = served([], { PLACE_LIST: JSON.stringify([{ id: 'home', app: true, on: true }, added('own-a')]) });

    expect(result).toEqual(['own-a']);
  });

  /** With every place off there is nothing to fetch, which the run answers as unavailable rather than serving one anyway. */
  test('serves nothing when every place is switched off', () => {
    const result = served(APP, { PLACE_LIST: saved([['home', false], ['work', false], ['cabin', false]]) });

    expect(result).toEqual([]);
  });
});

describe('arrangePlaces', () => {
  /**
   * The page saves this answer. Switching on the first place with a fix instead stored a current
   * location that had none at that moment as switched off for good, and the wearer's first place with it.
   */
  test('switches on the first place in the list for a saved First Location Only, fix or not', () => {
    const places = [{ key: 'here' }, { key: 'home' }, { key: 'work' }];

    const result = arrangePlaces(places, [], 'first').map((arranged) => ['place' in arranged ? arranged.place.key : '', arranged.on]);

    expect(result).toEqual([
      ['here', true],
      ['home', false],
      ['work', false],
    ]);
  });
});

describe('what planPlaces lets go of', () => {
  /** The saved list: home on, work off, and an added place on. */
  const SETTINGS = { PLACE_LIST: JSON.stringify([{ id: 'home', app: true, on: true }, { id: 'work', app: true, on: false }, added('own-a')]) };

  /** The Pebble app's list: home and work, both with coordinates. */
  const HOME_WORK = located([place('home'), place('work')]);

  /** A place switched off keeps no copy or ask, so switched back on it is fetched straight away rather than served an old reading. */
  test('lets go of a place switched off', () => {
    const { gone } = planPlaces(HOME_WORK, SETTINGS);

    const result = gone('work');

    expect(result).toBe(true);
  });

  /**
   * First Location Only switches the other places off as surely as the list does. Judged from the
   * saved list alone, those places never counted as off and kept their copies.
   */
  test('lets go of the places a saved First Location Only switches off', () => {
    const { gone } = planPlaces(located(APP), { PLACE_LIST: '[]', PLACES: 'first' });

    const result = [gone('home'), gone('work'), gone('cabin')];

    expect(result).toEqual([false, true, true]);
  });

  /** An added place removed on the page never comes back under the same id, so its copy and ask would only pile up. */
  test('lets go of an added place taken off the list', () => {
    const { gone } = planPlaces(HOME_WORK, SETTINGS);

    const result = [gone('own-a'), gone('own-b')];

    expect(result).toEqual([false, true]);
  });

  /**
   * The Pebble app can leave a current location with no fix out of its list rather than list it with no
   * coordinates. Counting that as removed lost the place's copy and last ask, so a failing provider was
   * asked for it again as soon as it was back. Only a switch lets a Pebble app place go.
   */
  test('keeps a Pebble app place a read left out, unless it is switched off', () => {
    const { gone } = planPlaces(located([place('home')]), SETTINGS);

    const result = [gone('cabin'), gone('work')];

    expect(result).toEqual([false, true]);
  });

  /** A saved place a read left out is not one the run can fetch, and serving it would send a face a place with no weather. */
  test('serves nothing for a listed place the read left out', () => {
    const result = served([place('home')], { PLACE_LIST: saved([['work', true], ['home', true]]) });

    expect(result).toEqual(['home']);
  });

  /**
   * A current location with no fix is still in the read, only without coordinates. Forgetting its ask
   * had a failing provider asked for it again the moment the fix came back, spending a keyed quota.
   */
  test('keeps a place the read listed without coordinates', () => {
    const { gone, serve } = planPlaces([noFix('here'), ...HOME_WORK], { PLACE_LIST: '[]' });

    const result = [gone('here'), serve.map((each) => each.key)];

    expect(result).toEqual([false, ['home', 'work']]);
  });

  /** A refused read says nothing about which places were removed, and forgetting them all had every one asked again once the read came back. */
  test('keeps every Pebble app place switched on while the read is refused', () => {
    const { gone } = planPlaces([], SETTINGS);

    const result = [gone('home'), gone('cabin'), gone('work')];

    expect(result).toEqual([false, false, true]);
  });

  /** Pebble App Places off switches every Pebble app place off, so each one is fetched fresh once it is back on. */
  test('lets go of every Pebble app place while Pebble App Places is off', () => {
    const { gone } = planPlaces(HOME_WORK, { ...SETTINGS, USE_APP_PLACES: false });

    const result = [gone('home'), gone('own-a')];

    expect(result).toEqual([true, false]);
  });

  /** A run with nothing to serve reads and rewrites every kept copy and ask, which is wasted when nothing can be gone. */
  test('says nothing can be gone when nothing is switched off', () => {
    const result = [planPlaces([], { PLACE_LIST: saved([['home', true]]) }).anyGone, planPlaces([], SETTINGS).anyGone, planPlaces(HOME_WORK, {}).anyGone];

    expect(result).toEqual([false, true, false]);
  });
});
