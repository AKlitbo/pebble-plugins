/**
 * Specs for what Weather Enhanced declares in its appinfo.
 *
 * The appinfo is JSON, so its `weather/location` source is a hand copy of the framework's
 * `WEATHER_LOCATION_SOURCE`, which declares what `locationInstance` sends. The Pebble app drops any
 * property or shape the copy leaves out. Each provider's site needs its own Internet permission, or the
 * Pebble app turns its fetch away, and reading the places in the Pebble app's weather list needs Location.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test, expect } from 'vitest';
import { WEATHER_LOCATION_SOURCE } from '../../paf/ts/plugin-app/weather';

const APPINFO = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', 'pebble.appinfo.json'), 'utf8'));

/** One usesPermissions entry as the appinfo writes it. */
interface Permission {
  name: string;
  parameters?: { domains: string[] };
  required: boolean;
  reason: string;
}

describe('the appinfo', () => {
  /** A property the copy leaves out never reaches a face or the watch's own Weather app. */
  test('declares the weather source exactly as the framework serves it', () => {
    const result = APPINFO.plugin.sources;

    expect(result).toEqual([WEATHER_LOCATION_SOURCE]);
  });

  /**
   * A provider's site with no permission is turned away. Open-Meteo fills every provider's forecast, and
   * the places need Location, so the plugin cannot work without either. The other two stay optional, so
   * the wearer allows only the one they use.
   */
  test("asks for each provider's site on its own, with only Open-Meteo and Location required", () => {
    const result = APPINFO.usesPermissions.map((permission: Permission) => [permission.name, permission.parameters?.domains, permission.required, permission.reason.length > 0]);

    expect(result).toEqual([
      ['Internet', ['open-meteo.com'], true, true],
      ['Internet', ['api.openweathermap.org'], false, true],
      ['Internet', ['api.weatherapi.com'], false, true],
      ['Location', undefined, true, true],
    ]);
  });
});
