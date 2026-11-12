/**
 * Stocks + Crypto's watchlist, one ordered list of stock and crypto tickers.
 *
 * The settings page keeps it as JSON in the `WATCHLIST` setting, and the plugin reads it back. Each
 * entry is a ticker and whether it is a stock, priced by the wearer's provider, or crypto, always
 * priced by Yahoo. `finance/stock` serves the whole list in its order, so the wearer decides what a
 * face showing only the first few tickers shows. `finance/crypto` serves the crypto entries in theirs.
 *
 * The list holds at most 8 stocks and 8 crypto tickers. A list saved before the watchlist existed was
 * two comma lists, `TICKERS` and `CRYPTO_TICKERS`, and reads as one list with the stocks first.
 */

import { STOCK_SYMBOL_RE, parseSymbols } from '../paf/ts/stock/symbols';
import { MOST_TICKERS } from './limits';

/** The message the settings page sends the plugin to add a ticker. */
export const ADD_MESSAGE = 'stocks-crypto-add';

/** The message the settings page sends the plugin for the names of the tickers already priced. */
export const NAMES_MESSAGE = 'stocks-crypto-names';

/** Who prices an entry: the wearer's provider for a stock, Yahoo for crypto. */
export type Kind = 'stock' | 'crypto';

/** One ticker on the watchlist. */
export interface WatchEntry {
  ticker: string;
  kind: Kind;
}

/** The list a wearer starts with, the S&P 500 as Pebble's own Stocks plugin starts with. */
export const DEFAULT_WATCHLIST: WatchEntry[] = [{ ticker: '^GSPC', kind: 'stock' }];

/**
 * Puts entries in the agreed form: each ticker cleaned to uppercase, a ticker that is not one dropped,
 * a ticker already on the list dropped, and each kind held to its 8.
 */
function cleaned(entries: WatchEntry[]): WatchEntry[] {
  const kept: WatchEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const ticker = String(entry.ticker || '').trim().toUpperCase();
    const count = kept.filter((other) => other.kind === entry.kind).length;

    if (STOCK_SYMBOL_RE.test(ticker) && !seen.has(ticker) && count < MOST_TICKERS) {
      seen.add(ticker);
      kept.push({ ticker, kind: entry.kind });
    }
  }

  return kept;
}

/**
 * Reads a saved watchlist.
 *
 * @param raw The `WATCHLIST` setting as saved, JSON text.
 * @return The list, or null when the setting holds no list, such as one never saved.
 */
export function parseWatchlist(raw: unknown): WatchEntry[] | null {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }

  try {
    const saved = JSON.parse(raw);

    if (!Array.isArray(saved)) {
      return null;
    }

    const entries = saved.filter((entry) => entry && typeof entry.ticker === 'string' && (entry.kind === 'stock' || entry.kind === 'crypto'));

    return cleaned(entries);
  } catch {
    return null;
  }
}

/**
 * The wearer's watchlist from their settings.
 *
 * A saved watchlist wins. Without one, the two comma lists saved before the watchlist existed read as
 * one list with the stocks first, and with neither the list is the default.
 *
 * @param settings The settings as `readSettings` gives them.
 * @return The watchlist.
 */
export function watchlistOf(settings: Record<string, unknown>): WatchEntry[] {
  const saved = parseWatchlist(settings.WATCHLIST);

  if (saved) {
    return saved;
  }

  if (typeof settings.TICKERS === 'string' || typeof settings.CRYPTO_TICKERS === 'string') {
    const stocks = parseSymbols(settings.TICKERS, MOST_TICKERS).map((ticker): WatchEntry => ({ ticker, kind: 'stock' }));
    const crypto = parseSymbols(settings.CRYPTO_TICKERS, MOST_TICKERS).map((ticker): WatchEntry => ({ ticker, kind: 'crypto' }));

    return cleaned([...stocks, ...crypto]);
  }

  return DEFAULT_WATCHLIST;
}

/**
 * Writes a watchlist as the `WATCHLIST` setting saves it.
 *
 * @param entries The list.
 * @return Its JSON text.
 */
export function serializeWatchlist(entries: WatchEntry[]): string {
  return JSON.stringify(entries.map((entry) => ({ ticker: entry.ticker, kind: entry.kind })));
}

/** What adding a ticker gives back: the longer list, or the reason it was turned away. */
export type Added = { entries: WatchEntry[]; error?: undefined } | { error: string; entries?: undefined };

/**
 * Adds a ticker to the end of the watchlist, as the settings page's Add Stock and Add Crypto do.
 *
 * @param entries The list as it stands.
 * @param raw What the wearer typed.
 * @param kind Whether it is a stock or crypto.
 * @return The list with the ticker added, or why it was not.
 */
export function addToWatchlist(entries: WatchEntry[], raw: unknown, kind: Kind): Added {
  const ticker = String(raw || '').trim().toUpperCase();
  const word = kind === 'crypto' ? 'crypto tickers' : 'stocks';

  if (!ticker) {
    return { error: 'Type a ticker first.' };
  }

  if (!STOCK_SYMBOL_RE.test(ticker)) {
    return { error: `${ticker} is not a ticker. Use letters, digits, and . ^ = / : _ -, up to 15.` };
  }

  if (entries.some((entry) => entry.ticker === ticker)) {
    return { error: `${ticker} is already on the list.` };
  }

  if (entries.filter((entry) => entry.kind === kind).length >= MOST_TICKERS) {
    return { error: `The list takes ${MOST_TICKERS} ${word}. Drop one to add another.` };
  }

  return { entries: [...entries, { ticker, kind }] };
}
