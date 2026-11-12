/**
 * Stocks + Crypto's answers to its settings page.
 *
 * The framework's `handleSettings` loads and saves the settings. This sits in front of it for the
 * watchlist. A load hands the page the watchlist the plugin reads, so a list saved as the two comma
 * lists before the watchlist existed opens as one list, and a Save keeps it. The page asks here to add
 * a ticker, so the checks on what a ticker is, on duplicates, and on the caps are written once, beside
 * the plugin that reads the list. It also asks for the names the last prices came with, to show beside
 * each ticker.
 */

import { LOAD_MESSAGE, SAVE_MESSAGE, handleSettings } from '../../paf/ts/plugin-app/settings';
import type { SettingsOptions, SettingsStorage } from '../../paf/ts/plugin-app/settings';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { ADD_MESSAGE, NAMES_MESSAGE, addToWatchlist, parseWatchlist, serializeWatchlist, watchlistOf } from '../watchlist';
import type { Kind } from '../watchlist';
import { readCopy } from './copies';
import { liftStops } from './gates';
import { PROVIDERS } from '../settings';

/** A config handler, as the plugin runtime calls one. */
type ConfigHandler = (message: unknown, respond: (reply: unknown) => void) => void | Promise<void>;

/** The name each ticker's last price came with, from the copy of the last prices. */
function namesOf(storage: SettingsStorage): Record<string, string> {
  const copy = readCopy(storage);
  const names: Record<string, string> = {};

  Object.keys(copy ? copy.entries : {}).forEach((ticker) => {
    const name = copy && copy.entries[ticker].quote.name;

    if (name) {
      names[ticker] = name;
    }
  });

  return names;
}

/** The message's type, or undefined for anything that is not a message. */
function typeOf(message: unknown): unknown {
  return typeof message === 'object' && message !== null ? (message as { type?: unknown }).type : undefined;
}

/**
 * Answers the settings page, the framework's load and save with the watchlist's own messages beside them.
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
    const type = typeOf(message);

    if (type === NAMES_MESSAGE) {
      respond({ names: namesOf(storage) });
      return;
    }

    if (type === ADD_MESSAGE) {
      const asked = message as { watchlist?: unknown; ticker?: unknown; kind?: unknown };
      const kind: Kind = asked.kind === 'crypto' ? 'crypto' : 'stock';
      const added = addToWatchlist(parseWatchlist(asked.watchlist) || [], asked.ticker, kind);

      const last = added.entries ? added.entries[added.entries.length - 1] : null;

      // the ticker alone, cleaned, so the page adds it to the list as it stands when the answer lands
      respond(last ? { ticker: last.ticker, kind: last.kind, names: namesOf(storage) } : { error: added.error });
      return;
    }

    if (!settingsHandler) {
      respond({ error: 'the plugin is not ready' });
      return;
    }

    await settingsHandler(message, (reply) => {
      const settings = typeof reply === 'object' && reply !== null ? (reply as { settings?: Record<string, unknown> }).settings : undefined;

      // the page opens on the list the plugin reads, so a Save keeps a list saved the old way
      if (type === LOAD_MESSAGE && settings) {
        settings.WATCHLIST = serializeWatchlist(watchlistOf(settings));
      }

      // any save lifts a stop after a bad key, as the page promises, even one that changed nothing
      if (type === SAVE_MESSAGE) {
        liftStops(storage, PROVIDERS.map((provider) => provider.id));
      }

      respond(reply);
    });
  });
}
