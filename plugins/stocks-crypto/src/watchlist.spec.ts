/**
 * Specs for the watchlist, the one ordered list of stock and crypto tickers.
 *
 * The page saves it as JSON and the plugin reads it back, so a saved value that is not quite right has
 * to read as the list the wearer meant, never as one past its caps or with a ticker twice. A list saved
 * as the two comma lists before the watchlist existed has to read as one list with the stocks first,
 * or the first Save after an update would lose it. Adding is where the wearer meets the rules, so a
 * duplicate, a junk ticker, and a full kind each come back with a reason.
 */

import { describe, test, expect } from 'vitest';
import { addToWatchlist, DEFAULT_WATCHLIST, parseWatchlist, serializeWatchlist, watchlistOf } from './watchlist';
import type { WatchEntry } from './watchlist';

/** A list of one kind of ticker, named T1, T2, and so on. */
function many(count: number, kind: 'stock' | 'crypto'): WatchEntry[] {
  return Array.from({ length: count }, (_unused, index) => ({ ticker: `${kind === 'crypto' ? 'C' : 'T'}${index + 1}`, kind }));
}

describe('parseWatchlist', () => {
  /** The order is the wearer's, so a face showing only the first few shows the ones they put first. */
  test('keeps the order the wearer saved, stocks and crypto mixed', () => {
    const saved = serializeWatchlist([{ ticker: 'BTC-USD', kind: 'crypto' }, { ticker: 'AAPL', kind: 'stock' }]);

    const result = parseWatchlist(saved);

    expect(result).toEqual([{ ticker: 'BTC-USD', kind: 'crypto' }, { ticker: 'AAPL', kind: 'stock' }]);
  });

  /** A list past its caps would spend calls the caps are there to save, and a ticker twice would spend two on one price. */
  test('holds each kind to 8 and drops a ticker already on the list', () => {
    const saved = serializeWatchlist([...many(9, 'stock'), ...many(9, 'crypto'), { ticker: 'T1', kind: 'crypto' }]);

    const result = parseWatchlist(saved)?.map((entry) => entry.ticker);

    expect(result).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
  });

  /** A value that is not a list is no list at all, so the settings fall back rather than serving nothing. */
  test.each(['', 'not json', '{"ticker":"AAPL"}', undefined])('reads %j as no list', (raw) => {
    const result = parseWatchlist(raw);

    expect(result).toBe(null);
  });
});

describe('watchlistOf', () => {
  /** The first Save after an update would otherwise put the default over the wearer's two comma lists. */
  test('reads the comma lists saved before the watchlist as one list, stocks first', () => {
    const result = watchlistOf({ TICKERS: 'aapl, MSFT', CRYPTO_TICKERS: 'BTC-USD' });

    expect(result).toEqual([{ ticker: 'AAPL', kind: 'stock' }, { ticker: 'MSFT', kind: 'stock' }, { ticker: 'BTC-USD', kind: 'crypto' }]);
  });

  /** Once the wearer saves the watchlist, the old lists still in storage must not come back. */
  test('takes a saved watchlist over the comma lists', () => {
    const result = watchlistOf({ WATCHLIST: serializeWatchlist([{ ticker: 'IBM', kind: 'stock' }]), TICKERS: 'AAPL' });

    expect(result).toEqual([{ ticker: 'IBM', kind: 'stock' }]);
  });

  /** A wearer who never saved anything starts on the S&P 500, as Pebble's own Stocks plugin does. */
  test('starts on the default with nothing saved', () => {
    const result = watchlistOf({ WATCHLIST: '' });

    expect(result).toEqual(DEFAULT_WATCHLIST);
  });
});

describe('addToWatchlist', () => {
  /** A ticker twice would show twice and spend two calls on the same price. */
  test('refuses a ticker already on the list, whatever its kind', () => {
    const result = addToWatchlist([{ ticker: 'BTC-USD', kind: 'crypto' }], 'btc-usd', 'stock');

    expect(result).toEqual({ error: 'BTC-USD is already on the list.' });
  });

  /** The ninth stock would go past what a round can fetch, so the wearer is told why it did not go on. */
  test('refuses a ninth stock and says why', () => {
    const result = addToWatchlist(many(8, 'stock'), 'NEW', 'stock');

    expect(result).toEqual({ error: 'The list takes 8 stocks. Drop one to add another.' });
  });

  /** A full stock list says nothing about crypto, which has its own 8. */
  test('takes crypto beside 8 stocks', () => {
    const result = addToWatchlist(many(8, 'stock'), 'BTC-USD', 'crypto').entries?.slice(-1);

    expect(result).toEqual([{ ticker: 'BTC-USD', kind: 'crypto' }]);
  });

  /** A ticker no provider can spell would only ever show an error on the watch. */
  test('refuses something that is not a ticker', () => {
    const result = addToWatchlist([], 'AAPL MSFT', 'stock').error;

    expect(result).toBe('AAPL MSFT is not a ticker. Use letters, digits, and . ^ = / : _ -, up to 15.');
  });
});
