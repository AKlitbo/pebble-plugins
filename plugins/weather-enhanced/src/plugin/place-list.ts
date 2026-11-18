/**
 * The wearer's place list, read back from its saved JSON and laid over the Pebble app's weather list.
 *
 * For a place from the Pebble app the list keeps only its key and switch, in the wearer's order. Its
 * name and coordinates come from the Pebble app's own read every time, so nothing here goes stale. A
 * place the list does not mention, such as one added in the Pebble app since the wearer last saved,
 * goes after the listed ones, switched on, so it reaches watchfaces without a visit to the settings
 * page. A place added on the page keeps its own name and coordinates and goes out as it is.
 */

import { fetchablePlaces } from '../../paf/ts/plugin-app/weather';
import type { ListedWeatherPlace, WeatherPlace } from '../../paf/ts/plugin-app/weather';
import { roundCoordinate, validCoords } from '../../paf/ts/weather/coords';
import { ADDED_PREFIX, FIRST_PLACE_ONLY, MOST_ADDED, MOST_PLACES, NAME_MAX } from '../settings';
import type { AddedPlaceEntry, AppPlaceEntry, PlaceEntry } from '../settings';

// a key from the Pebble app is a uuid today, and the cap leaves it room to grow
// an entry past this is dropped, and its place falls in at the bottom, switched on
const ID_MAX = 256;

// the Pebble app holds five places and the page adds five more, so a saved list past this is broken
// the cut counts the entries kept, so junk ahead of the real ones never pushes them past it
const LIST_MAX = 20;

/** A place from the Pebble app's weather list, as far as the arranging goes. */
export interface ListedPlace {
  key: string;
}

/**
 * One place in the wearer's order with its switch: from the Pebble app's list, added on the page, or a
 * Pebble app place the list holds that this read did not have.
 */
export type ArrangedPlace<T extends ListedPlace> = { place: T; on: boolean } | { added: AddedPlaceEntry; on: boolean } | { unread: AppPlaceEntry; on: boolean };

/** A saved switch, or on for anything that is not one, since every place starts switched on. */
function switchOf(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true;
}

/** An added place read from its saved fields, or null for one that does not read right. */
function addedEntry(id: string, fields: Record<string, unknown>): AddedPlaceEntry | null {
  const name = typeof fields.name === 'string' ? fields.name.trim().slice(0, NAME_MAX) : '';
  const coords = { lat: fields.lat as number, lon: fields.lon as number };

  return id.startsWith(ADDED_PREFIX) && name && validCoords(coords) ? { id, on: switchOf(fields.on), name, lat: roundCoordinate(coords.lat), lon: roundCoordinate(coords.lon) } : null;
}

/**
 * A place the settings page wants to add, checked the way every saved one is read back, so the page
 * only ever adds a place the plugin will keep.
 *
 * @param place The place as the page sends it, which may hold anything.
 * @return The entry with its name trimmed and its coordinates rounded, or null for one that would not read back.
 */
export function checkAddedPlace(place: unknown): AddedPlaceEntry | null {
  const fields = place && typeof place === 'object' ? (place as Record<string, unknown>) : {};

  return typeof fields.id === 'string' && fields.id.length <= ID_MAX ? addedEntry(fields.id, fields) : null;
}

/**
 * Reads the saved place list, keeping only the entries that read right.
 *
 * Each entry is checked on its own and a bad one costs only itself, so a Pebble app place falls in after
 * the listed ones, switched on, as a place the list never mentioned. A switch that is not true or false
 * reads as on, and the entry keeps its place in the order. Only the first entry for a key counts, and
 * only the first five added places.
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

  for (const entry of parsed as unknown[]) {
    if (entries.length >= LIST_MAX) {
      break;
    }

    const fields = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const id = fields.id;

    if (typeof id !== 'string' || !id || id.length > ID_MAX || entries.some((kept) => kept.id === id)) {
      continue;
    }

    if (fields.app === true) {
      entries.push({ id, app: true, on: switchOf(fields.on) });
      continue;
    }

    const own = added < MOST_ADDED ? addedEntry(id, fields) : null;

    if (own) {
      entries.push(own);
      added++;
    }
  }

  return entries;
}

/**
 * Puts the Pebble app's places and the added ones in the wearer's order, each with its switch.
 *
 * The listed places come first, in the list's order. A listed Pebble app place this read does not have
 * keeps its place and its switch as unread, since a read can leave out a place that is still the
 * wearer's, such as a current location with no fix. Every Pebble app place the list does not mention follows in the Pebble app's order, switched
 * on. While the list holds no Pebble app place, a saved Places to Fetch of First Location Only switches
 * on only the first place in the Pebble app's list, with a fix or not. A current location with no fix
 * right now stays the wearer's first place, so a page saved while it has none keeps it on. That covers a
 * list saved empty and one holding only added places, so the setting lasts until a save lists the
 * Pebble app's places.
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

    arranged.push(place ? { place, on: entry.on } : { unread: entry, on: entry.on });
  });

  const firstOnly = placesToFetch === FIRST_PLACE_ONLY && !list.some((entry) => 'app' in entry);
  const first = places[0];

  places.forEach((place) => {
    if (!list.some((entry) => entry.id === place.key)) {
      arranged.push({ place, on: !firstOnly || place === first });
    }
  });

  return arranged;
}

/** What a run does with the places: which ones it serves, and which kept places it can let go of. */
export interface PlacePlan {
  /** The places to fetch and serve, the ones switched on that have coordinates, in the wearer's order, at most five. */
  serve: WeatherPlace[];
  /** Whether a place, by its key or an added place's id, was switched off or removed, so its kept copy and last ask can go. */
  gone: (key: string) => boolean;
  /**
   * Whether this run can let any kept place go for a reason it knows without reading what is kept. It is
   * false when nothing is switched off. An added place taken off the list then waits for the next run
   * that serves a place.
   */
  anyGone: boolean;
}

/**
 * Lays the wearer's place list over this run's read of the Pebble app's weather list, once, for both
 * what the run serves and what it lets go of, so the two always agree.
 *
 * The run serves the places switched on, in the wearer's order, skipping one with no coordinates so the
 * next moves up, at most five. The Pebble app's places count only while Pebble App Places is on, and an
 * added place goes out under its own id.
 *
 * A place switched off, by the list, by a saved First Location Only, or by Pebble App Places, lets go
 * of its kept copy and last ask, so switched back on it is fetched straight away. So does an added
 * place once the list no longer holds it. A Pebble app place is never let go of because a read left it
 * out, since the Pebble app can leave out a current location with no fix, so a place missing from the
 * run for any reason but a switch keeps both. That costs a kept copy and ask for a place removed in the
 * Pebble app, which stay until the wearer switches it off, and is worth it so a missed read never
 * spends a keyed provider's quota.
 *
 * @param places This run's read of the Pebble app's weather list, with coordinates or not, or none when the read was refused.
 * @param settings The saved settings, which carry the place list, Pebble App Places, and any saved Places to Fetch.
 * @return The places to serve and what can be let go of.
 */
export function planPlaces(places: ListedWeatherPlace[], settings: Record<string, unknown>): PlacePlan {
  const list = readPlaceList(settings.PLACE_LIST);
  const useApp = settings.USE_APP_PLACES !== false;
  const arranged = arrangePlaces(places, list, settings.PLACES);
  const isOn = (one: ArrangedPlace<ListedWeatherPlace>) => one.on && ('added' in one || useApp);
  const keyOf = (one: ArrangedPlace<ListedWeatherPlace>) => ('added' in one ? one.added.id : 'unread' in one ? one.unread.id : one.place.key);
  const switches = new Map(arranged.map((one) => [keyOf(one), isOn(one)]));
  const switchedOn = arranged.filter(isOn).flatMap((one): ListedWeatherPlace[] => {
    if ('added' in one) {
      return [{ key: one.added.id, name: one.added.name, lat: one.added.lat, lon: one.added.lon, current: false, located: true }];
    }

    return 'place' in one ? [one.place] : [];
  });

  return {
    serve: fetchablePlaces(switchedOn).slice(0, MOST_PLACES),
    gone: (key) => (switches.has(key) ? !switches.get(key) : key.startsWith(ADDED_PREFIX)),
    anyGone: [...switches.values()].some((on) => !on),
  };
}
