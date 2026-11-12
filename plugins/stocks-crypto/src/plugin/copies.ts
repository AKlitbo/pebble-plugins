/**
 * The copy of the last prices Stocks + Crypto served, kept between runs.
 *
 * The Pebble app runs the plugin far more often than any provider's prices are worth fetching, so most
 * runs answer from this copy. It carries the provider and a fingerprint of the API key, never the key
 * itself, since only the encrypted storage holds that, and a fingerprint of the ticker lists. A save
 * that changes the provider, the key, or Paid Plan leaves the copy behind. One that changes the lists
 * has the next run fetch, with the copy's quotes standing in for any ticker it cannot.
 */

import type { StockQuote } from '../../paf/ts/stock/util';

/** Where the copy is kept in `localStorage`. */
export const COPY_KEY = 'stocks-crypto-copy';

// the Pebble app's runs come about five minutes apart and can land a little early
// a copy this close to the Refresh Interval counts as due, or a 5 minute interval would fetch every other run
export const EARLY_RUN_MS = 60 * 1000;

/** The part of `localStorage` the copy uses, which a spec stands in for. */
export type CopyStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** One ticker's quote as served, and who priced it. */
export interface Entry {
  quote: StockQuote;
  /** The provider's name, such as Yahoo, for the instance's `source`. */
  source: string;
}

/** The copy as kept. */
export interface Copy {
  /** The provider and the fingerprint of the key. */
  id: string;
  /** The fingerprint of the provider and the ticker lists, which a run still matches while the key cannot be read. */
  lists: string;
  /** When the copy was last brought up to date. */
  roundMs: number;
  /** When a round's refused tickers are next asked for, ahead of the Refresh Interval, or 0. */
  retryAtMs: number;
  /** A fingerprint of the saved settings it was made under, so any save has the next run fetch. */
  saved: string;
  /** The tickers in the order they are served. */
  order: string[];
  entries: Record<string, Entry>;
}

/**
 * A short fingerprint of some text, enough to tell a changed key or list from the same one without
 * keeping the text.
 *
 * @param text The text.
 * @return Its fingerprint.
 */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }

  return hash.toString(16);
}

/** True for an entry that reads back the way it was kept. */
function isEntry(entry: unknown): entry is Entry {
  const kept = entry as Entry | null;

  return Boolean(kept && typeof kept.source === 'string' && kept.quote && typeof kept.quote.ok === 'boolean' && typeof kept.quote.price === 'number');
}

/**
 * The kept copy.
 *
 * @param storage Where the copy is kept, normally `localStorage`.
 * @return The copy, or null for none or one that does not read back as a copy.
 */
export function readCopy(storage: CopyStorage): Copy | null {
  try {
    const copy = JSON.parse(storage.getItem(COPY_KEY) || 'null');
    const readable = copy && typeof copy.id === 'string' && typeof copy.lists === 'string' && typeof copy.roundMs === 'number' && Array.isArray(copy.order) && copy.entries && typeof copy.entries === 'object';

    if (!readable || !copy.order.every((ticker: unknown) => typeof ticker === 'string' && isEntry(copy.entries[ticker]))) {
      return null;
    }

    return { ...copy, retryAtMs: typeof copy.retryAtMs === 'number' ? copy.retryAtMs : 0, saved: typeof copy.saved === 'string' ? copy.saved : '' };
  } catch {
    return null;
  }
}

/**
 * Keeps the copy.
 *
 * @param storage Where the copy is kept, normally `localStorage`.
 * @param copy The copy.
 */
export function saveCopy(storage: CopyStorage, copy: Copy): void {
  try {
    storage.setItem(COPY_KEY, JSON.stringify(copy));
  } catch (error) {
    console.log(`Stocks + Crypto: the prices could not be kept, ${error}`);
  }
}

/**
 * Whether a copy can still be served without a fetch.
 *
 * A clock set back makes the copy look younger than nothing, which is no reason to keep serving it.
 *
 * @param copy The copy.
 * @param refreshMs The Refresh Interval.
 * @param nowMs The time now.
 * @return Whether it is still fresh.
 */
export function isFresh(copy: Copy, refreshMs: number, nowMs: number): boolean {
  const age = nowMs - copy.roundMs;

  return age >= 0 && age < refreshMs - EARLY_RUN_MS;
}
