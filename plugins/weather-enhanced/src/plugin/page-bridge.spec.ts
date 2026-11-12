/**
 * Specs for the plugin's answers to its settings page, in front of the framework's settings handler.
 *
 * The unit rows show the Pebble app's own units beside Pebble App, from the plugin's answer. A refused
 * read has to answer an error rather than the framework's default units, or the page would tell a
 * wearer on °F that Pebble App means °C.
 */

import { describe, test, expect } from 'vitest';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';
import { UNITS_MESSAGE } from '../settings';
import { IMPERIAL_UNITS, bridgeWith } from './testing/fake-bridge';

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
