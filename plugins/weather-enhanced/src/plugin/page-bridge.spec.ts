/**
 * Specs for the plugin's answers to its settings page, in front of the framework's settings handler.
 *
 * The unit rows show the Pebble app's own units beside Pebble App, from the plugin's answer. A refused
 * read has to answer an error rather than the framework's default units, or the page would tell a
 * wearer on °F that Pebble App means °C.
 *
 * The place list on the page is written back to the saved settings as soon as it arrives, so it has to
 * be exactly what the runs would serve: the wearer's order and switches, every place the Pebble app
 * lists, the added places, and a saved First Location Only. A refused or empty read has to answer the
 * saved list as it stands, so the page still shows the added places and saves the rest back untouched.
 */

import { describe, test, expect } from 'vitest';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';
import { PLACES_MESSAGE, UNITS_MESSAGE } from '../settings';
import { IMPERIAL_UNITS, appPlace, bridgeWith } from './testing/fake-bridge';

/** The Pebble app's list: a current location with no fix yet, then two saved places. */
const APP_LIST: SourceEnvelope = {
  instances: [appPlace('here', '', undefined, true), appPlace('toronto', 'Toronto', [43.65, -79.38]), appPlace('london', 'London', [51.51, -0.13])],
};

/** A place added on the page, switched off. */
const COTTAGE = { id: 'own-k3j9q2', on: false, name: 'Cottage', lat: 45.1234, lon: -79.5678 };

/** Asks the plugin for the place list with these settings saved, and hands back each place as id and switch. */
async function placeList(settings: Record<string, unknown>, readPlaces: () => Promise<SourceEnvelope> = async () => APP_LIST): Promise<unknown> {
  const ask = bridgeWith(async () => IMPERIAL_UNITS, { readPlaces, settings });
  const reply = (await ask({ type: PLACES_MESSAGE })) as { places?: Array<{ id: string; on: boolean }>; error?: unknown };

  return reply.places ? reply.places.map((place) => [place.id, place.on]) : reply;
}

describe('the units ask', () => {
  /** The page shows these beside Pebble App, so they have to be the Pebble app's own. */
  test("answers with the Pebble app's units", async () => {
    const ask = bridgeWith(async () => IMPERIAL_UNITS);

    const result = await ask({ type: UNITS_MESSAGE });

    expect(result).toEqual({ units: { temperature: '°F', windSpeed: 'mph', pressure: 'inHg' } });
  });

  /** A refused read answered with the default units would show °C to a wearer whose Pebble app is set to °F. */
  test.each([
    ['a refused read', (): Promise<SourceEnvelope> => Promise.reject(Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }))],
    ['a read with no units', (): Promise<SourceEnvelope> => Promise.resolve({ instances: [] })],
  ])('answers an error for %s rather than the default units', async (_case, readUnits) => {
    const ask = bridgeWith(readUnits);

    const reply = (await ask({ type: UNITS_MESSAGE })) as { units?: unknown; error?: unknown };
    const result = [reply.units, typeof reply.error];

    expect(result).toEqual([undefined, 'string']);
  });
});

describe('the places ask', () => {
  /** The page names each place and tags the current location, and a wrong name or tag would point the wearer at the wrong row. */
  test('answers every place the Pebble app lists, with its name and whether it is the current location', async () => {
    const ask = bridgeWith(async () => IMPERIAL_UNITS, { readPlaces: async () => APP_LIST });

    const result = await ask({ type: PLACES_MESSAGE });

    expect(result).toEqual({
      places: [
        { id: 'here', name: '', current: true, on: true, added: false },
        { id: 'toronto', name: 'Toronto', current: false, on: true, added: false },
        { id: 'london', name: 'London', current: false, on: true, added: false },
      ],
    });
  });

  /** The page saves what it is sent, so an order or a switch lost here would be lost on the next save. */
  test('answers the saved order and switches, with a place the list never named after them', async () => {
    const result = await placeList({ PLACE_LIST: JSON.stringify([{ id: 'london', app: true, on: true }, { id: 'here', app: true, on: false }]) });

    expect(result).toEqual([
      ['london', true],
      ['here', false],
      ['toronto', true],
    ]);
  });

  /**
   * First Location Only fetched the first place with coordinates. The page saves this answer, so the
   * current location with no fix has to stay off and Toronto on, or the save would switch the wearer to
   * a place with no weather.
   */
  test('answers a saved First Location Only as only the first place with coordinates on', async () => {
    const result = await placeList({ PLACES: 'first' });

    expect(result).toEqual([
      ['here', false],
      ['toronto', true],
      ['london', false],
    ]);
  });

  /** The page draws an added place from this answer alone, so a lost name or coordinate would be lost on the next save. */
  test('answers an added place where the list puts it, with its name and coordinates', async () => {
    const ask = bridgeWith(async () => IMPERIAL_UNITS, { readPlaces: async () => APP_LIST, settings: { PLACE_LIST: JSON.stringify([{ id: 'toronto', app: true, on: true }, COTTAGE]) } });

    const result = ((await ask({ type: PLACES_MESSAGE })) as { places: unknown[] }).places.slice(0, 2);

    expect(result).toEqual([
      { id: 'toronto', name: 'Toronto', current: false, on: true, added: false },
      { id: 'own-k3j9q2', name: 'Cottage', current: false, on: false, added: true, lat: 45.1234, lon: -79.5678 },
    ]);
  });

  /**
   * A read refused before the wearer allows Location has no Pebble app places to lay out. Answering
   * none would have the page save over the wearer's order, so the saved list comes back as it stands,
   * with the reason.
   */
  test('answers the saved list with the reason for a refused read', async () => {
    const ask = bridgeWith(async () => IMPERIAL_UNITS, { readPlaces: () => Promise.reject(Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' })), settings: { PLACE_LIST: JSON.stringify([{ id: 'london', app: true, on: false }, COTTAGE]) } });

    const result = await ask({ type: PLACES_MESSAGE });

    expect(result).toEqual({
      places: [
        { id: 'london', name: '', current: false, on: false, added: false, unread: true },
        { id: 'own-k3j9q2', name: 'Cottage', current: false, on: false, added: true, lat: 45.1234, lon: -79.5678 },
      ],
      error: 'PERMISSION_DENIED',
    });
  });

  /** A read that comes back empty for a moment would otherwise drop every saved Pebble app place on the next save. */
  test('answers the saved list as it stands for a read with no places', async () => {
    const result = await placeList({ PLACE_LIST: JSON.stringify([{ id: 'london', app: true, on: false }]) }, async () => ({ instances: [] }));

    expect(result).toEqual([['london', false]]);
  });
});
