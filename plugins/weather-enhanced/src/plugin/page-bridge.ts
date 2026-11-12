/**
 * Weather Enhanced's answers to its settings page.
 *
 * The framework's `handleSettings` loads and saves the settings. This sits in front of it so a save
 * the plugin kept also lifts a provider's stop after a bad key, since a save is where the wearer fixes
 * a key, and a rate limit stop on a provider whose Paid Plan it switched. It also answers the page's
 * ask for the Pebble app's units, which the unit rows show beside Pebble App.
 */

import { SAVE_MESSAGE, SETTINGS_KEY, handleSettings } from '../../paf/ts/plugin-app/settings';
import type { SettingsOptions, SettingsStorage } from '../../paf/ts/plugin-app/settings';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { NO_UNITS, readPebbleAppUnits } from '../../paf/ts/plugin-app/weather';
import type { WeatherUnits } from '../../paf/ts/plugin-app/weather';
import { PROVIDERS, UNITS_MESSAGE } from '../settings';
import type { ProviderId } from '../settings';
import { liftKeyStops, liftRateLimits } from './gates';

/** A config handler, as the plugin runtime calls one. */
type ConfigHandler = (message: unknown, respond: (reply: unknown) => void) => void | Promise<void>;

/** Each keyed provider's saved Paid Plan switch, read from the settings kept in `localStorage`. */
function paidPlans(saved: unknown): Partial<Record<ProviderId, boolean>> {
  const settings = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  const plans: Partial<Record<ProviderId, boolean>> = {};

  PROVIDERS.forEach((provider) => {
    if (provider.paidSetting) {
      plans[provider.id] = settings[provider.paidSetting] === true;
    }
  });

  return plans;
}

/** The saved settings, or none for anything that does not read back. */
function savedSettings(storage: SettingsStorage): unknown {
  try {
    return JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');
  } catch {
    return null;
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
 * Answers the settings page, the framework's load and save with the stops lifted on a save, and the
 * Pebble app's units.
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
