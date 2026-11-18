/**
 * The places Weather Enhanced fetches, from the Pebble app's weather list and the places added on the
 * settings page, in the wearer's order.
 *
 * The framework reads the list from the Pebble app's Preferences plugin, in the Pebble app's order,
 * with a place that has no coordinates marked, such as a current location the phone has no fix for
 * yet. The wearer's place list then puts them in its own order with the added places, drops the ones
 * switched off, and skips one with no coordinates this run, so the first place is the first one
 * switched on that can be fetched. A read the Pebble app refuses still leaves the added places to fetch.
 */

import { listWeatherPlaces } from '../../paf/ts/plugin-app/weather';
import type { WeatherPlace } from '../../paf/ts/plugin-app/weather';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { planPlaces } from './place-list';
import type { PlacePlan } from './place-list';

/**
 * The places to fetch this run, the ones switched on in the wearer's order, at most five, and which
 * kept places the run can let go of.
 *
 * It subscribes to the Pebble app's list as it reads it, so the Pebble app runs the plugin again when
 * the wearer changes the list.
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param settings The saved settings, which carry the place list.
 * @return The places to fetch, what the run can let go of, and the reason when the Pebble app refused the read.
 */
export async function placesToFetch(pebble: PluginPebble, settings: Record<string, unknown>): Promise<{ places: WeatherPlace[]; error?: string } & Pick<PlacePlan, 'gone' | 'anyGone'>> {
  const read = await listWeatherPlaces(pebble, { subscribe: true });
  const { serve, gone, anyGone } = planPlaces(read.places, settings);

  return { ...(read.error ? { error: read.error } : {}), places: serve, gone, anyGone };
}
