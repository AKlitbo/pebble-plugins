/**
 * Specs for the weather face's own keys.
 *
 * The WMO code is one of the extras the face is for, and a plugin can serve it as a single value or
 * only as an hourly series, so both have to land and the right hour has to be read. A plugin that
 * serves no coordinates has to read as no fix rather than the last place.
 */
import { describe, expect, test } from 'vitest';
import { formatCoords, NO_FIX, NO_WMO, weatherExtras, wmoCode } from './weather-keys';

// 13 Nov 2026 at 00:00 UTC, the start of the hourly series below
const SERIES_START = 1794528000;

describe('wmoCode', () => {
  /** The single value is what the plugin says the sky is now, so it wins over the series. */
  test('reads the single value first', () => {
    const envelope = { instances: [{ properties: { weather_code: { numericValue: { value: 3 } } } }] };

    const result = wmoCode(envelope, SERIES_START * 1000);

    expect(result).toBe(3);
  });

  /** Weather+ serves the code only hourly, and reading the wrong hour would show the wrong sky. */
  test('reads the hourly series at the hour holding now', () => {
    const series = { start: SERIES_START, stepSec: 3600, numericValue: { values: [0, 61, 95] } };
    const envelope = { instances: [{ properties: { hourly_weather_code: { series } } }] };

    const result = wmoCode(envelope, (SERIES_START + 3600 + 1800) * 1000);

    expect(result).toBe(61);
  });

  /** A plugin with no code has to show a dash, not a clear sky. */
  test('reads no code as NO_WMO', () => {
    const result = wmoCode({ instances: [{ properties: {} }] }, SERIES_START * 1000);

    expect(result).toBe(NO_WMO);
  });
});

describe('weatherExtras', () => {
  /** The watch fonts only carry ASCII, so a place with an accent would show a box. */
  test('sends the first place in ASCII beside its code', () => {
    const envelope = { instances: [{ properties: { name: { longText: { text: 'Montréal' } }, weather_code: { numericValue: { value: 0 } } } }] };

    const result = weatherExtras(envelope, { TEST_PLACE: 12, TEST_WMO: 13 }, SERIES_START * 1000);

    expect(result).toEqual({ 12: 'Montreal', 13: 0 });
  });
});

describe('formatCoords', () => {
  /** A plugin that serves no coordinates has to read as no fix on the watch, not as the last place. */
  test('sends no fix when the plugin serves no coordinates', () => {
    const result = formatCoords({ LOCATION_LATITUDE: 10, LOCATION_LONGITUDE: 11 }, { temperature: 4, condition: 'CLOUDY', location: 'Toronto', ok: true });

    expect(result).toEqual({ 10: NO_FIX, 11: NO_FIX });
  });
});
