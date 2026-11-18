/**
 * The wearer's place list, read back from its saved JSON and laid over the Pebble app's weather list.
 *
 * For a place from the Pebble app the list keeps only its key and switch, in the wearer's order. Its
 * name and coordinates come from the Pebble app's own read every time, so nothing here goes stale. A
 * place the list does not mention, such as one added in the Pebble app since the wearer last saved,
 * goes after the listed ones, switched on, so it reaches watchfaces without a visit to the settings
 * page. A place added on the page keeps its own name and coordinates and goes out as it is.
 */

import type { WeatherPlace } from '../../paf/ts/plugin-app/weather';
import { ADDED_PREFIX, FIRST_PLACE_ONLY, MOST_ADDED, MOST_PLACES, NAME_MAX } from '../settings';
import type { AddedPlaceEntry, PlaceEntry } from '../settings';

// a key from the Pebble app is a uuid, so anything much longer is not one
const ID_MAX = 64;

// the Pebble app holds five places and the page adds five more, so a saved list past this is broken
// cutting it keeps a run from walking a list of any length
const LIST_MAX = 20;

/** A place from the Pebble app's weather list, as far as the arranging goes. */
export interface ListedPlace {
  key: string;
  /** Whether the place has coordinates this time. Left out, it does. */
  located?: boolean;
}

/** One place in the wearer's order with its switch, either from the Pebble app's list or added on the page. */
export type ArrangedPlace<T extends ListedPlace> = { place: T; on: boolean } | { added: AddedPlaceEntry; on: boolean };

/** A coordinate rounded to four decimals, about 11 m, or null for anything that is not one inside the range. */
function coordinate(value: unknown, range: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= range ? Math.round(value * 10000) / 10000 : null;
}

/** An added place read from its saved fields, or null for one that does not read right. */
function addedEntry(id: string, fields: Record<string, unknown>): AddedPlaceEntry | null {
  const name = typeof fields.name === 'string' ? fields.name.trim().slice(0, NAME_MAX) : '';
  const lat = coordinate(fields.lat, 90);
  const lon = coordinate(fields.lon, 180);

  return id.startsWith(ADDED_PREFIX) && name && lat !== null && lon !== null && typeof fields.on === 'boolean' ? { id, on: fields.on, name, lat, lon } : null;
}

/**
 * Reads the saved place list, keeping only the entries that read right.
 *
 * Each entry is checked on its own and a bad one costs only itself, so a Pebble app place falls in after
 * the listed ones, switched on, as a place the list never mentioned. Only the first entry for a key
 * counts, and only the first five added places.
 *
 * @param saved The saved `PLACE_LIST`, which may be missing or hold anything.
 * @return The entries in the wearer's order, or none for anything that is not a list.
 */
export function readPlaceList(saved: unknown): PlaceEntry[] {
  let parsed: unknown;

  try {
    parsed = typeof saved === 'string' ? JSON.parse(saved) : null;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const entries: PlaceEntry[] = [];
  let added = 0;

  parsed.slice(0, LIST_MAX).forEach((entry: unknown) => {
    const fields = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const id = fields.id;

    if (typeof id !== 'string' || !id || id.length > ID_MAX || entries.some((kept) => kept.id === id)) {
      return;
    }

    if (fields.app === true) {
      if (typeof fields.on === 'boolean') {
        entries.push({ id, app: true, on: fields.on });
      }

      return;
    }

    const own = added < MOST_ADDED ? addedEntry(id, fields) : null;

    if (own) {
      entries.push(own);
      added++;
    }
  });

  return entries;
}

/**
 * Puts the Pebble app's places and the added ones in the wearer's order, each with its switch.
 *
 * The listed places come first, in the list's order. A listed key the Pebble app no longer has is
 * skipped. Every Pebble app place the list does not mention follows in the Pebble app's order, switched
 * on. With nothing listed, a saved Places to Fetch of First Location Only switches on only the first
 * place that has coordinates, as that setting fetched.
 *
 * @param places The Pebble app's places, in its order.
 * @param list The wearer's place list.
 * @param placesToFetch The saved Places to Fetch, if a save still holds one.
 * @return Every place, in the wearer's order, with its switch.
 */
export function arrangePlaces<T extends ListedPlace>(places: T[], list: PlaceEntry[], placesToFetch: unknown): ArrangedPlace<T>[] {
  const arranged: ArrangedPlace<T>[] = [];

  list.forEach((entry) => {
    if (!('app' in entry)) {
      arranged.push({ added: entry, on: entry.on });
      return;
    }

    const place = places.find((each) => each.key === entry.id);

    if (place) {
      arranged.push({ place, on: entry.on });
    }
  });

  const firstOnly = list.length === 0 && placesToFetch === FIRST_PLACE_ONLY;
  const first = places.find((place) => place.located !== false);

  places.forEach((place) => {
    if (!list.some((entry) => entry.id === place.key)) {
      arranged.push({ place, on: !firstOnly || place === first });
    }
  });

  return arranged;
}

/**
 * The places a run serves: the ones switched on, in the wearer's order, at most five. The Pebble app's
 * places count only while Pebble App Places is on, and an added place goes out under its own id.
 *
 * @param places The places this run's read of the Pebble app's weather list could fetch, in its order.
 * @param settings The saved settings, which carry the place list and Pebble App Places.
 * @return The places to fetch and serve.
 */
export function placesToServe(places: WeatherPlace[], settings: Record<string, unknown>): WeatherPlace[] {
  const useApp = settings.USE_APP_PLACES !== false;

  return arrangePlaces(places, readPlaceList(settings.PLACE_LIST), settings.PLACES)
    .filter((arranged) => arranged.on && ('added' in arranged || useApp))
    .slice(0, MOST_PLACES)
    .map((arranged) => ('added' in arranged ? { key: arranged.added.id, name: arranged.added.name, lat: arranged.added.lat, lon: arranged.added.lon, current: false } : arranged.place));
}
