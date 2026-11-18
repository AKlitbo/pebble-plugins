/**
 * The places Weather Enhanced fetches, from the Pebble app's weather list and the places added on the
 * settings page, in the wearer's order.
 *
 * The framework reads the list from the Pebble app's Preferences plugin, in the Pebble app's order,
 * and leaves out a place with no coordinates, such as a current location the phone has no fix for
 * yet. The wearer's place list then puts them in its own order with the added places, and drops the
 * ones switched off, so the first place is the first one switched on that can be fetched this run. A
 * read the Pebble app refuses still leaves the added places to fetch.
 */

import { weatherLocations } from '../../paf/ts/plugin-app/weather';
import type { WeatherPlace } from '../../paf/ts/plugin-app/weather';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { placesToServe } from './place-list';

/**
 * The places to fetch this run, the ones switched on in the wearer's order, at most five.
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param settings The saved settings, which carry the place list.
 * @return The places to fetch, and the reason when the Pebble app refused the read.
 */
export async function placesToFetch(pebble: PluginPebble, settings: Record<string, unknown>): Promise<{ places: WeatherPlace[]; error?: string }> {
  const read = await weatherLocations(pebble);

  return { ...read, places: placesToServe(read.places, settings) };
}
