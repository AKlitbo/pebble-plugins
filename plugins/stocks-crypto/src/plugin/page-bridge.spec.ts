/**
 * Specs for the plugin's answers to its settings page, in front of the framework's settings handler.
 *
 * The page opens on whatever the load hands it and saves whatever it shows, so a load that handed it
 * the default over a list saved as the two comma lists would lose that list on the first Save. Adding
 * is checked here, so the page shows the plugin's own reason when a ticker is turned away, and a good
 * add comes back as the ticker alone for the page to put on the list as it stands. Every other
 * message has to reach the framework's handler as it would without this in front.
 */

import { describe, test, expect } from 'vitest';
import { LOAD_MESSAGE, SETTINGS_KEY } from '../../paf/ts/plugin-app/settings';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { SETTINGS_OPTIONS } from '../settings';
import { ADD_MESSAGE, serializeWatchlist } from '../watchlist';
import { handlePage } from './page-bridge';

/** A plugin runtime holding these saved settings, and the handler the page talks to. */
function pageWith(saved: Record<string, unknown>) {
  const items = new Map<string, string>([[SETTINGS_KEY, JSON.stringify(saved)]]);
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
  let handler: ((message: unknown, respond: (reply: unknown) => void) => void | Promise<void>) | null = null;
  const pebble = {
    registerConfigHandler: (registered: typeof handler) => void (handler = registered),
    refreshSources: () => undefined,
    secureStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
  } as unknown as PluginPebble;

  handlePage(SETTINGS_OPTIONS, pebble, storage);

  return async (message: unknown): Promise<Record<string, unknown>> => {
    let reply: unknown = null;

    await handler!(message, (answer) => void (reply = answer));

    return reply as Record<string, unknown>;
  };
}

describe('handlePage', () => {
  /** The page saves what it opens on, so it has to open on the list the old comma lists hold. */
  test('opens the page on a list saved as the two comma lists, stocks first', async () => {
    const ask = pageWith({ TICKERS: 'AAPL', CRYPTO_TICKERS: 'BTC-USD' });

    const reply = await ask({ type: LOAD_MESSAGE });
    const result = (reply.settings as Record<string, unknown>).WATCHLIST;

    expect(result).toBe(serializeWatchlist([{ ticker: 'AAPL', kind: 'stock' }, { ticker: 'BTC-USD', kind: 'crypto' }]));
  });

  /** The wearer has to see why a ticker did not go on, in the plugin's words. */
  test('answers an add of a ticker already on the list with the reason', async () => {
    const ask = pageWith({});

    const result = await ask({ type: ADD_MESSAGE, watchlist: serializeWatchlist([{ ticker: 'AAPL', kind: 'stock' }]), ticker: 'aapl', kind: 'stock' });

    expect(result).toEqual({ error: 'AAPL is already on the list.' });
  });

  /** The page adds the ticker to the list as it stands when the answer lands, so the answer is the cleaned ticker alone. */
  test('answers a good add with the cleaned ticker and its kind', async () => {
    const ask = pageWith({});

    const reply = await ask({ type: ADD_MESSAGE, watchlist: serializeWatchlist([{ ticker: 'AAPL', kind: 'stock' }]), ticker: ' btc-usd ', kind: 'crypto' });
    const result = [reply.ticker, reply.kind, reply.watchlist];

    expect(result).toEqual(['BTC-USD', 'crypto', undefined]);
  });
});
