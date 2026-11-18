/**
 * Weather Enhanced's answers to its settings page.
 *
 * The framework's `handleSettings` loads and saves the settings. Its hooks have a save the plugin kept
 * also lift a provider's stop after a bad key, since a save is where the wearer fixes a key, and a rate
 * limit stop on a provider whose Paid Plan it switched. They also answer the page's ask for the Pebble
 * app's units, which the unit rows show beside Pebble App, its ask for the place list, the Pebble app's
 * places and the added ones in the wearer's order with their switches, and its ask to check a place
 * before Add a Place adds it.
 */

import { handleSettings, readSettings } from '../../paf/ts/plugin-app/settings';
import type { SettingsOptions, SettingsStorage } from '../../paf/ts/plugin-app/settings';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { NO_UNITS, listWeatherPlaces, readPebbleAppUnits } from '../../paf/ts/plugin-app/weather';
import type { ListedWeatherPlace, WeatherUnits } from '../../paf/ts/plugin-app/weather';
import { ADD_PLACE_MESSAGE, PLACES_MESSAGE, PROVIDERS, UNITS_MESSAGE } from '../settings';
import type { ProviderId } from '../settings';
import { liftKeyStops, liftRateLimits } from './gates';
import { arrangePlaces, checkAddedPlace, readPlaceList } from './place-list';
import type { ArrangedPlace } from './place-list';

/** One place on the page's place list. */
export interface PagePlace {
  /** The place's key in the Pebble app's weather list, or its own id for an added place. */
  id: string;
  /** Its name, which can be empty for the Pebble app's current location or a place this read did not have. */
  name: string;
  /** Whether it is the Pebble app's current location. */
  current: boolean;
  /** Whether watchfaces get it. */
  on: boolean;
  /** Whether the wearer added it on the page, so it carries its own coordinates. */
  added: boolean;
  lat?: number;
  lon?: number;
  /** A Pebble app place this read could not show, which the page keeps in its place without a row. */
  unread?: boolean;
  /** For a Pebble app place this read showed, whether it has coordinates, so a run can fetch it. A current location with no fix has none. */
  located?: boolean;
}

/** Each keyed provider's Paid Plan switch in a set of settings. */
function paidPlans(settings: Record<string, unknown>): Partial<Record<ProviderId, boolean>> {
  const plans: Partial<Record<ProviderId, boolean>> = {};

  PROVIDERS.forEach((provider) => {
    if (provider.paidSetting) {
      plans[provider.id] = settings[provider.paidSetting] === true;
    }
  });

  return plans;
}

/**
 * The Pebble app's own units, or why there are none. A refused read, or one that names no units,
 * answers the error alone, so the page shows Pebble App with no unit rather than a default.
 */
async function appUnits(pebble: PluginPebble): Promise<{ units?: WeatherUnits; error?: string }> {
  const read = await readPebbleAppUnits(pebble);

  return read.units ? { units: read.units } : { error: read.error || NO_UNITS };
}

/** One arranged place as the page shows it. A Pebble app place this read did not have has no name and is marked unread. */
function pagePlace(arranged: ArrangedPlace<ListedWeatherPlace>): PagePlace {
  if ('added' in arranged) {
    const { id, name, lat, lon } = arranged.added;

    return { id, name, current: false, on: arranged.on, added: true, lat, lon };
  }

  if ('unread' in arranged) {
    return { id: arranged.unread.id, name: '', current: false, on: arranged.on, added: false, unread: true };
  }

  const { key, name, current, located } = arranged.place;

  return { id: key, name, current, on: arranged.on, added: false, located };
}

/**
 * The place list as the page shows it, every place in the wearer's order with its switch, and why the
 * Pebble app's places are missing when the read was refused. It is laid out from the saved settings
 * the page also loads, so the two always agree. The read takes in the current location with no fix,
 * marked as not located, so the page can keep it in its place even on a run that skips it, and makes
 * no subscription, since the page only shows the list.
 *
 * A saved Pebble app place the read does not list keeps its place and its switch, marked unread, so a
 * read that is refused, comes back empty, or leaves one place out never wipes the wearer's choices. The
 * page shows no row for it and saves it back as it was. The settings and the read go out together.
 */
async function placeList(options: SettingsOptions, pebble: PluginPebble, storage: SettingsStorage): Promise<{ places: PagePlace[]; error?: string }> {
  // the secret keys play no part in the list, so they are left unread
  const [settings, read] = await Promise.all([readSettings({ defaults: options.defaults }, pebble, storage), listWeatherPlaces(pebble)]);
  const places = arrangePlaces(read.places, readPlaceList(settings.PLACE_LIST), settings.PLACES).map(pagePlace);

  return read.error ? { places, error: read.error } : { places };
}

/**
 * Answers the settings page: the framework's load and save, with the stops lifted on a kept save, and
 * the page's asks for the Pebble app's units and the place list.
 *
 * @param options The plugin's settings options.
 * @param pebble The plugin runtime's `Pebble`.
 * @param storage Where the settings that are not secret are kept, normally `localStorage`.
 */
export function handlePage(options: SettingsOptions, pebble: PluginPebble, storage: SettingsStorage): void {
  handleSettings(options, pebble, storage, {
    // a message of any other type goes unanswered here, and the framework answers it with its error
    onMessage: async (type, message, respond) => {
      if (type === UNITS_MESSAGE) {
        respond(await appUnits(pebble));
      } else if (type === PLACES_MESSAGE) {
        respond(await placeList(options, pebble, storage));
      } else if (type === ADD_PLACE_MESSAGE) {
        respond({ entry: checkAddedPlace((message as { place?: unknown }).place) });
      }
    },
    // any save the plugin kept lifts a stop after a bad key, even one that changed nothing
    // a save it refused changed nothing the wearer could have fixed, so it never gets here
    onSaved: (before, after) => {
      const was = paidPlans(before);
      const now = paidPlans(after);

      liftKeyStops(storage);
      liftRateLimits(storage, (Object.keys(now) as ProviderId[]).filter((provider) => now[provider] !== was[provider]));
    },
  });
}
