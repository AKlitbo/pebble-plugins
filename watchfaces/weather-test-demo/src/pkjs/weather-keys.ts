/**
 * The weather face's own keys, beside the ones the framework sends.
 *
 * The framework turns the plugin's update into the reading every weather face shows, and the face
 * wants a little more than that. The coordinates ride on every weather message. The place's name and
 * the WMO code ride on the report, read straight off the plugin's update, so the watch shows them as
 * the plugin sent them.
 */

import wire from '../../paf/ts/pkjs/wire';
import { firstProperties, numeric, seriesIndex, seriesValue, text } from '../../paf/ts/plugin-shapes/shapes';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';
import type { WeatherResult } from '../../paf/ts/weather/util';

/** How long a place name the watch holds, one short of its 32 byte buffer. */
const PLACE_MAX = 31;

/** What the coordinate keys carry when the plugin serves none, which the watch shows as it is. */
export const NO_FIX = 'NO FIX';

/** What TEST_WMO carries when the plugin serves no WMO code, which the watch shows as a dash. */
export const NO_WMO = -1;

/**
 * Builds the coordinate keys for every weather message.
 *
 * @param messageKeys The face's message keys, by name.
 * @param result The weather result about to go to the watch.
 * @return The keys to add to the weather message.
 */
export function formatCoords(messageKeys: Record<string, number>, result: WeatherResult): AppMessageDict {
  return {
    [messageKeys.LOCATION_LATITUDE]: typeof result.lat === 'number' ? result.lat.toFixed(4) : NO_FIX,
    [messageKeys.LOCATION_LONGITUDE]: typeof result.lon === 'number' ? result.lon.toFixed(4) : NO_FIX,
  };
}

/**
 * Reads the WMO code off the first place, as the single value or else the hourly series at the hour
 * holding now. A plugin can serve either one, or both.
 *
 * @param envelope The plugin's update.
 * @param nowMs The moment to treat as now.
 * @return The code, or NO_WMO when the plugin serves none.
 */
export function wmoCode(envelope: SourceEnvelope, nowMs: number): number {
  const properties = firstProperties(envelope) || {};
  const single = numeric(properties.weather_code);

  if (single) {
    return Math.round(single.value);
  }

  const series = properties.hourly_weather_code ? properties.hourly_weather_code.series : undefined;
  const hourly = seriesValue(series, 'numericValue', seriesIndex(series, Math.floor(nowMs / 1000)));

  return hourly ? Math.round(hourly.value) : NO_WMO;
}

/**
 * Builds the face's own keys for the report: the first place's name and its WMO code.
 *
 * @param envelope The plugin's last update, or null before one, which adds nothing.
 * @param messageKeys The face's message keys, by name.
 * @param nowMs The moment to treat as now.
 * @return The keys to add to the report.
 */
export function weatherExtras(envelope: SourceEnvelope | null, messageKeys: Record<string, number>, nowMs: number): AppMessageDict {
  if (!envelope) {
    return {};
  }

  const properties = firstProperties(envelope) || {};
  const place = text(properties.name, 'long');

  return {
    [messageKeys.TEST_PLACE]: place ? wire.toAscii(place, PLACE_MAX) : '',
    [messageKeys.TEST_WMO]: wmoCode(envelope, nowMs),
  };
}
