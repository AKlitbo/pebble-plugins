/**
 * The places Weather Enhanced fetches, from the Pebble app's weather list.
 *
 * The framework reads the list from the Pebble app's Preferences plugin, in the wearer's order, and
 * leaves out a place with no coordinates, such as a current location the phone has no fix for yet. So
 * the first place is the first one that can be fetched this run.
 */

import { weatherLocations } from '../../paf/ts/plugin-app/weather';
import type { WeatherPlace } from '../../paf/ts/plugin-app/weather';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { MOST_PLACES } from '../settings';

/**
 * The places to fetch this run, the first one or the first five, as Places to Fetch says.
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param setting The saved Places to Fetch, `first` or `all`.
 * @return The places in the wearer's order, and the reason when the Pebble app refused the read.
 */
export async function placesToFetch(pebble: PluginPebble, setting: unknown): Promise<{ places: WeatherPlace[]; error?: string }> {
  const read = await weatherLocations(pebble);

  return { ...read, places: read.places.slice(0, setting === 'first' ? 1 : MOST_PLACES) };
}
