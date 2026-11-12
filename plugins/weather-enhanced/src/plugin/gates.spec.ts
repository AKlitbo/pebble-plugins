/**
 * Specs for the stops Weather Enhanced keeps after a provider turned a fetch away.
 *
 * A stop that lifts too soon has the provider asked again only to refuse again, and one that lifts too
 * late leaves the wearer on Open-Meteo, or on nothing, long after their own provider is back. The
 * windows are each provider's own, so they are pinned one by one.
 */

import { describe, test, expect } from 'vitest';
import { STOP_HOLDS_MS, liftKeyStops, liftRateLimits, setStop, stoppedBy } from './gates';
import { NOW_MS, memoryStorage } from './testing/fake-phone';

describe('a rate limit stop', () => {
  /**
   * A bare rate limit holds until the provider's shortest limit opens, a rolling minute for Open-Meteo
   * and OpenWeatherMap, and never past an hour, so WeatherAPI.com is not held a month for one burst.
   * Its spent month, which the answer names, holds until the 1st, UTC. A key on a paid plan has no free
   * plan's window, so it waits a minute whatever the answer named.
   */
  test.each([
    ['openmeteo', false, undefined, 61 * 1000],
    ['owm', false, undefined, 61 * 1000],
    ['weatherapi', false, undefined, 60 * 60 * 1000],
    ['weatherapi', false, 'month', Date.UTC(2026, 11, 1, 0, 1) - NOW_MS],
    ['owm', true, undefined, 60 * 1000],
    ['weatherapi', true, 'month', 60 * 1000],
  ] as const)('holds %s, paid %s, limit %s, for exactly its window', (provider, paid, limit, holdsMs) => {
    const storage = memoryStorage();

    setStop(storage, provider, 'print', 'RATE LIMIT', NOW_MS, paid, limit);
    const result = [stoppedBy(storage, provider, 'print', NOW_MS + holdsMs - 1), stoppedBy(storage, provider, 'print', NOW_MS + holdsMs)];

    expect(result).toEqual(['RATE LIMIT', null]);
  });

  /** A key the wearer swapped in has never been refused, so the old key's stop must not hold it. */
  test('does not hold a different key', () => {
    const storage = memoryStorage();

    setStop(storage, 'owm', 'old-key', 'RATE LIMIT', NOW_MS, false);
    const result = stoppedBy(storage, 'owm', 'new-key', NOW_MS);

    expect(result).toBeNull();
  });

  /** A save only lifts a rate limit when it changed the plan the provider was held to. */
  test('stays through a save, and lifts when Paid Plan changes', () => {
    const storage = memoryStorage();

    setStop(storage, 'owm', 'print', 'RATE LIMIT', NOW_MS, false);
    liftKeyStops(storage);
    const kept = stoppedBy(storage, 'owm', 'print', NOW_MS);

    liftRateLimits(storage, ['owm']);

    const result = [kept, stoppedBy(storage, 'owm', 'print', NOW_MS)];

    expect(result).toEqual(['RATE LIMIT', null]);
  });
});

describe('a bad key stop', () => {
  /** A key can be fixed on the provider's side with no save, so a stop that never lifts would leave it unused for good. */
  test('lifts on its own after a day', () => {
    const storage = memoryStorage();

    setStop(storage, 'owm', 'print', 'INVALID KEY', NOW_MS, false);
    const result = [stoppedBy(storage, 'owm', 'print', NOW_MS + STOP_HOLDS_MS - 1), stoppedBy(storage, 'owm', 'print', NOW_MS + STOP_HOLDS_MS)];

    expect(result).toEqual(['INVALID KEY', null]);
  });

  /** A clock set back past the stop would hold the provider for however far the clock moved. */
  test('lifts when the clock is set back before it', () => {
    const storage = memoryStorage();

    setStop(storage, 'owm', 'print', 'INVALID KEY', NOW_MS, false);
    const result = stoppedBy(storage, 'owm', 'print', NOW_MS - 1);

    expect(result).toBeNull();
  });
});
