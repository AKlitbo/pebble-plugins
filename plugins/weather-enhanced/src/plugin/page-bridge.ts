/**
 * Weather Enhanced's answers to its settings page.
 *
 * The framework's `handleSettings` loads and saves the settings. This sits in front of it so a save
 * the plugin kept also lifts a provider's stop after a bad key, since a save is where the wearer fixes
 * a key, and a rate limit stop on a provider whose Paid Plan it switched. It also answers the page's
 * ask for the Pebble app's units, which the unit rows show beside Pebble App, and its ask for the place
 * list, the Pebble app's places and the added ones in the wearer's order with their switches.
 */

import { SAVE_MESSAGE, SETTINGS_KEY, handleSettings } from '../../paf/ts/plugin-app/settings';
import type { SettingsOptions, SettingsStorage } from '../../paf/ts/plugin-app/settings';
import type { PluginPebble, SourceRequest } from '../../paf/ts/plugin-app/runtime';
import { BUILT_IN_PREFERENCES, NO_UNITS, placesFrom, readPebbleAppUnits } from '../../paf/ts/plugin-app/weather';
import type { WeatherUnits } from '../../paf/ts/plugin-app/weather';
import { flag, instancesOf, propertiesOf, text } from '../../paf/ts/plugin-shapes/shapes';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';
import { PLACES_MESSAGE, PROVIDERS, UNITS_MESSAGE } from '../settings';
import type { PlaceEntry, ProviderId } from '../settings';
import { liftKeyStops, liftRateLimits } from './gates';
import { arrangePlaces, readPlaceList } from './place-list';

/** A config handler, as the plugin runtime calls one. */
type ConfigHandler = (message: unknown, respond: (reply: unknown) => void) => void | Promise<void>;

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
}

/** The read of the wearer's places from the Pebble app's built-in Preferences plugin, the one each run makes too. */
const PLACES_REQUEST: SourceRequest = { category: 'preferences', item: 'weather_location', plugin: BUILT_IN_PREFERENCES };

/** Each keyed provider's saved Paid Plan switch, read from the settings kept in `localStorage`. */
function paidPlans(settings: Record<string, unknown>): Partial<Record<ProviderId, boolean>> {
  const plans: Partial<Record<ProviderId, boolean>> = {};

  PROVIDERS.forEach((provider) => {
    if (provider.paidSetting) {
      plans[provider.id] = settings[provider.paidSetting] === true;
    }
  });

  return plans;
}

/** The saved settings, or none for anything that does not read back. */
function savedSettings(storage: SettingsStorage): Record<string, unknown> {
  try {
    const saved = JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');

    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

/** The message's type, or undefined for anything that is not a message. */
function typeOf(message: unknown): unknown {
  return typeof message === 'object' && message !== null ? (message as { type?: unknown }).type : undefined;
}

/**
 * The Pebble app's own units, or why there are none. A refused read, or one that names no units,
 * answers the error alone, so the page shows Pebble App with no unit rather than a default.
 */
async function appUnits(pebble: PluginPebble): Promise<{ units?: WeatherUnits; error?: string }> {
  const read = await readPebbleAppUnits(pebble);

  return read.units ? { units: read.units } : { error: read.error || NO_UNITS };
}

/**
 * Every place in the Pebble app's weather list, the current location with no fix included, so the
 * page can place it even on a run that skips it.
 */
function everyPlace(envelope: SourceEnvelope): Array<{ key: string; name: string; current: boolean; located: boolean }> {
  const located = placesFrom(envelope).map((place) => place.key);

  return instancesOf(envelope).flatMap((instance) => {
    const properties = propertiesOf(instance);
    const key = instance && typeof instance.instanceId === 'string' ? instance.instanceId : '';

    return properties && key ? [{ key, name: text(properties.name, 'short') || '', current: flag(properties.current) === true, located: located.includes(key) }] : [];
  });
}

/** A saved entry as the page shows it, a Pebble app place with no name since this read did not have it. */
function savedPlace(entry: PlaceEntry): PagePlace {
  return 'app' in entry ? { id: entry.id, name: '', current: false, on: entry.on, added: false, unread: true } : { id: entry.id, name: entry.name, current: false, on: entry.on, added: true, lat: entry.lat, lon: entry.lon };
}

/**
 * The place list as the page shows it, every place in the wearer's order with its switch, and why the
 * Pebble app's places are missing when the read was refused. It is laid out from the saved settings
 * the page also loads, so the two always agree.
 *
 * A read that is refused, or that lists no places, answers the saved list as it stands, its Pebble app
 * places marked unread. The page then still shows the added places and saves every entry back as it
 * was, so a read that fails or comes back empty for a moment never wipes the wearer's choices.
 */
async function placeList(pebble: PluginPebble, storage: SettingsStorage): Promise<{ places: PagePlace[]; error?: string }> {
  const settings = savedSettings(storage);
  const list = readPlaceList(settings.PLACE_LIST);
  let envelope: SourceEnvelope;

  try {
    envelope = await pebble.readSource(PLACES_REQUEST);
  } catch (error) {
    const failure = error as { code?: unknown; message?: unknown } | null;

    return { places: list.map(savedPlace), error: String((failure && (failure.code || failure.message)) || error) };
  }

  const places = everyPlace(envelope);

  if (places.length === 0) {
    return { places: list.map(savedPlace) };
  }

  return {
    places: arrangePlaces(places, list, settings.PLACES).map((arranged) => ('added' in arranged ? savedPlace(arranged.added) : { id: arranged.place.key, name: arranged.place.name, current: arranged.place.current, on: arranged.on, added: false })),
  };
}

/**
 * Answers the settings page, the framework's load and save with the stops lifted on a save, the
 * Pebble app's units, and the place list.
 *
 * @param options The plugin's settings options.
 * @param pebble The plugin runtime's `Pebble`.
 * @param storage Where the settings that are not secret are kept, normally `localStorage`.
 */
export function handlePage(options: SettingsOptions, pebble: PluginPebble, storage: SettingsStorage): void {
  let settingsHandler: ConfigHandler | null = null;
  // the framework's handler is caught here rather than registered, so this one answers first
  const catcher = Object.assign(Object.create(pebble) as PluginPebble, {
    registerConfigHandler: (handler: ConfigHandler) => void (settingsHandler = handler),
  });

  handleSettings(options, catcher, storage);

  pebble.registerConfigHandler(async (message, respond) => {
    if (typeOf(message) === UNITS_MESSAGE) {
      respond(await appUnits(pebble));
      return;
    }

    if (typeOf(message) === PLACES_MESSAGE) {
      respond(await placeList(pebble, storage));
      return;
    }

    if (!settingsHandler) {
      respond({ error: 'the plugin is not ready' });
      return;
    }

    const before = paidPlans(savedSettings(storage));

    await settingsHandler(message, (reply) => {
      const kept = typeOf(message) === SAVE_MESSAGE && typeof reply === 'object' && reply !== null && (reply as { ok?: unknown }).ok === true;

      // any save the plugin kept lifts a stop after a bad key, even one that changed nothing
      // a save it refused changed nothing the wearer could have fixed
      if (kept) {
        const after = paidPlans(savedSettings(storage));

        liftKeyStops(storage);
        liftRateLimits(storage, (Object.keys(after) as ProviderId[]).filter((provider) => after[provider] !== before[provider]));
      }

      respond(reply);
    });
  });
}
