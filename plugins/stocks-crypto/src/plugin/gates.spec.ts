/**
 * Specs for the record each provider keeps on top of the framework's ledger.
 *
 * What is pinned is how long each provider is left alone after each kind of trouble, since a wait too
 * short spends calls a provider will refuse and one too long leaves the watch on old prices, and which
 * tickers a retry asks for, since asking again for every ticker spends calls the others already got.
 * Then the record being per provider and per key, so one provider's limit never holds another and a
 * new key starts afresh.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in New York, which is UTC-5 then.
 */

import { describe, test, expect } from 'vitest';
import { BACKOFF_CAP_MS, BACKOFF_FIRST_MS } from '../../paf/ts/stock/schedule';
import stockUtil from '../../paf/ts/stock/util';
import type { StockQuote } from '../../paf/ts/stock/util';
import { limitsFor } from '../limits';
import type { ProviderId } from '../limits';
import { afterRound, gateFor, gateKey, liftStops, loadGate, pickTickers, saveGate } from './gates';
import type { GateRecord } from './gates';

const NOON = Date.UTC(2026, 10, 4, 17);

// a fingerprint of the saved settings, which a stop after a bad key is kept with
const SAVED = 'saved';
const MINUTE_MS = 60 * 1000;

const GOOD: StockQuote = stockUtil.ok('AAPL', 100, 1, 1, '2026-11-04');
const TIMED_OUT: StockQuote = { ...stockUtil.status('TIMEOUT'), spent: true };
const LOST: StockQuote = stockUtil.status('NET ERROR');

/** A RATE LIMIT quote in a provider's own words. */
function limited(message: string): StockQuote {
  return stockUtil.rateLimit(message);
}

/** A plain storage that keeps what it is given. */
function memory() {
  const items = new Map<string, string>();

  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
}

/** A fresh record for a provider. */
function fresh(provider: ProviderId): GateRecord {
  return loadGate(memory(), provider, '');
}

/** Moves a record on after one round on a free key, each ticker answered with the quote given. */
function round(record: GateRecord, provider: ProviderId, quotes: StockQuote[], nowMs: number, tickers = quotes.map((_quote, index) => `T${index}`)): void {
  afterRound(record, provider, limitsFor(provider, false), tickers, quotes, [], 0, SAVED, nowMs);
}

describe('the wait after a rate limit', () => {
  /** Yahoo can block a phone for a day, and asking again while blocked can make it longer, so each wait doubles. */
  test.each(['yahoo', 'finnhub'] as const)('waits on %s for 15 minutes, doubling to 2 hours', (provider) => {
    const record = fresh(provider);
    const waits: number[] = [];

    for (let hit = 0; hit < 5; hit++) {
      const nowMs = NOON + hit * 3 * 60 * MINUTE_MS;

      round(record, provider, [limited('Too Many Requests')], nowMs);
      waits.push(record.retryAtMs - nowMs);
    }

    expect(waits).toEqual([BACKOFF_FIRST_MS, 2 * BACKOFF_FIRST_MS, 4 * BACKOFF_FIRST_MS, BACKOFF_CAP_MS, BACKOFF_CAP_MS]);
  });

  /** Twelve Data's minute resets on the clock minute, and waiting out the 15 minute floor on top leaves the strip stale. */
  test("waits on Twelve Data until a second past the next clock minute after its minute's limit", () => {
    const record = fresh('twelvedata');

    round(record, 'twelvedata', [limited('You have run out of API credits for the current minute.')], NOON + 20 * 1000);
    const result = [record.retryAtMs, gateFor(record, 'twelvedata', limitsFor('twelvedata', false), false, [], '', NOON + 2 * MINUTE_MS).open];

    expect(result).toEqual([NOON + MINUTE_MS + 1000, true]);
  });

  /** Twelve Data's day resets at 00:00 UTC, and every call before then is refused. */
  test("waits on Twelve Data until just after 00:00 UTC after its day's limit", () => {
    const record = fresh('twelvedata');

    round(record, 'twelvedata', [limited('You have run out of API credits for the day.')], NOON);
    const result = record.retryAtMs;

    expect(result).toBe(Date.UTC(2026, 10, 5, 0, 1));
  });

  /** Alpha Vantage's daily cap holds until its day turns, so each evening try before then only meets the same refusal. */
  test("waits on Alpha Vantage's free key until New York's next day after its day's limit", () => {
    const record = fresh('alphavantage');

    round(record, 'alphavantage', [limited('Our standard API rate limit is 25 requests per day.')], NOON);
    const result = record.retryAtMs;

    expect(result).toBe(Date.UTC(2026, 10, 5, 5));
  });

  /**
   * Alpha Vantage's burst clears in seconds, and its reply names the daily limit too, so read as the day
   * it would leave the watch a day behind. The ticker keeps no new stamp, so it is asked for again.
   */
  test("asks again for the ticker Alpha Vantage's burst refused, after a wait of seconds", () => {
    const record = fresh('alphavantage');
    const burst = limited('Please consider spreading out your free API requests more sparingly (1 request per second). ... lift the free key rate limit (25 requests per day)');

    round(record, 'alphavantage', [burst], NOON, ['IBM']);
    const result = [record.retryAtMs - NOON, record.tickers.IBM, record.pending];

    expect(result).toEqual([5000, undefined, ['IBM']]);
  });

  /** A Finnhub limit says nothing about Yahoo, whose crypto prices would go stale for nothing. */
  test("keeps each provider's wait to itself", () => {
    const storage = memory();
    const finnhub = loadGate(storage, 'finnhub', '');

    round(finnhub, 'finnhub', [limited('Too Many Requests')], NOON);
    saveGate(storage, 'finnhub', finnhub);

    const result = gateFor(loadGate(storage, 'yahoo', ''), 'yahoo', limitsFor('yahoo', false), false, [], '', NOON + MINUTE_MS).open;

    expect(result).toBe(true);
  });
});

describe('the wait after a troubled call', () => {
  /** A call that reached a provider and timed out was counted, so asking again every run would spend the day on a provider that is not well. */
  test('waits 15 minutes after a round that timed out with nothing good, doubling after', () => {
    const record = fresh('twelvedata');
    const waits: number[] = [];

    for (let hit = 0; hit < 3; hit++) {
      const nowMs = NOON + hit * 3 * 60 * MINUTE_MS;

      round(record, 'twelvedata', [TIMED_OUT], nowMs);
      waits.push(record.retryAtMs - nowMs);
    }

    expect(waits).toEqual([BACKOFF_FIRST_MS, 2 * BACKOFF_FIRST_MS, 4 * BACKOFF_FIRST_MS]);
  });

  /**
   * A Twelve Data round asks for every ticker, so a 15 minute wait for one that timed out beside good
   * ones would bring the whole list back every 15 minutes, past the floor. It waits for the floor as a
   * face's does, which on a Saturday is 3 hours.
   */
  test('leaves a Twelve Data ticker that timed out beside good ones to the floor', () => {
    const record = fresh('twelvedata');
    const saturday = Date.UTC(2026, 10, 7, 17);

    round(record, 'twelvedata', [GOOD, TIMED_OUT], saturday, ['AAPL', 'MSFT']);
    const result = [record.retryAtMs, record.pending, gateFor(record, 'twelvedata', limitsFor('twelvedata', false), false, [], SAVED, saturday + 15 * MINUTE_MS).open];

    expect(result).toEqual([0, [], false]);
  });

  /** A call that never left the phone spent nothing and says nothing about the provider, so it sets no wait. */
  test('sets no wait after a round lost to the network', () => {
    const record = fresh('twelvedata');

    round(record, 'twelvedata', [LOST], NOON);
    const result = [record.retryAtMs, record.lastFetchMs];

    expect(result).toEqual([0, 0]);
  });

  /** Tickers the ledger had no room for have to come back when the room opens, not at the next floor. */
  test('asks again for the tickers the ledger left out once it has room', () => {
    const record = fresh('twelvedata');

    afterRound(record, 'twelvedata', limitsFor('twelvedata', false), ['AAPL'], [GOOD], ['MSFT'], NOON + MINUTE_MS + 1000, SAVED, NOON);
    const result = [record.retryAtMs, record.pending];

    expect(result).toEqual([NOON + MINUTE_MS + 1000, ['MSFT']]);
  });
});

describe('the gate', () => {
  /** Alpha Vantage's free key refuses a call less than a second after the last, so a run straight after a run must wait. */
  test("holds Alpha Vantage's free key to one call in a second", () => {
    const limits = limitsFor('alphavantage', false);
    const record = fresh('alphavantage');

    const result = [gateFor(record, 'alphavantage', limits, true, [NOON], '', NOON + 500).open, gateFor(record, 'alphavantage', limits, true, [NOON], '', NOON + 1100).open];

    expect(result).toEqual([false, true]);
  });

  /** A provider counts its free calls per key, so a new key must not wait out the old one's limit. */
  test('starts afresh under a different key', () => {
    const storage = memory();
    const old = loadGate(storage, 'twelvedata', 'old');

    round(old, 'twelvedata', [limited('You have run out of API credits for the day.')], NOON);
    saveGate(storage, 'twelvedata', old);

    const result = gateFor(loadGate(storage, 'twelvedata', 'new'), 'twelvedata', limitsFor('twelvedata', false), false, [], '', NOON + MINUTE_MS).open;

    expect(result).toBe(true);
  });

  /** A bad key fails every call, so fetching again before anything changes only spends the wearer's runs. */
  test('stops when every ticker answers INVALID KEY', () => {
    const record = fresh('finnhub');

    round(record, 'finnhub', [stockUtil.status('INVALID KEY'), stockUtil.status('INVALID KEY')], NOON);
    const result = gateFor(record, 'finnhub', limitsFor('finnhub', false), true, [], SAVED, NOON + 60 * MINUTE_MS);

    expect(result).toEqual({ open: false, status: 'INVALID KEY' });
  });

  /** Twelve Data answers a mistyped ticker the way it answers a bad key, and that one ticker must not stop the rest. */
  test('keeps fetching when only one ticker answers INVALID KEY', () => {
    const record = fresh('twelvedata');

    round(record, 'twelvedata', [GOOD, stockUtil.status('INVALID KEY')], NOON, ['AAPL', 'BAD']);
    const result = record.stop;

    expect(result).toBe('');
  });

  /** A wearer fixing the key on the provider's side, or saving anything, should not wait for a new key to be tried again. */
  test.each([
    ['a save', 'changed', NOON + MINUTE_MS],
    ['a day', SAVED, NOON + 24 * 60 * MINUTE_MS],
  ])('lifts the stop after %s', (_label, settings, nowMs) => {
    const record = fresh('finnhub');

    round(record, 'finnhub', [stockUtil.status('INVALID KEY')], NOON);

    const result = gateFor(record, 'finnhub', limitsFor('finnhub', false), true, [], settings, nowMs).open;

    expect(result).toBe(true);
  });
});

describe('pickTickers', () => {
  const limits = limitsFor('alphavantage', false);
  const evening = Date.UTC(2026, 10, 4, 22);

  /** A save that adds a ticker should price it next, rather than after every ticker already priced today. */
  test('fetches the Alpha Vantage ticker with no stamp first, then the one waiting longest', () => {
    const record = fresh('alphavantage');

    record.tickers = { IBM: { lastFetchMs: NOON - 4 * 60 * MINUTE_MS, lastAsOf: '2026-11-03' }, MSFT: { lastFetchMs: NOON - 5 * 60 * MINUTE_MS, lastAsOf: '2026-11-03' } };

    const result = [pickTickers(record, 'alphavantage', limits, ['IBM', 'MSFT', 'AAPL'], false, evening), pickTickers(record, 'alphavantage', limits, ['IBM', 'MSFT'], false, evening)];

    expect(result).toEqual([['AAPL'], ['MSFT']]);
  });

  /** Alpha Vantage only has the new close after the bell, so a ticker it already priced waits for the evening. */
  test('holds an Alpha Vantage ticker it already priced through the afternoon', () => {
    const record = fresh('alphavantage');

    record.tickers = { IBM: { lastFetchMs: NOON - 60 * MINUTE_MS, lastAsOf: '2026-11-03' } };

    const result = pickTickers(record, 'alphavantage', limits, ['IBM'], false, NOON);

    expect(result).toEqual([]);
  });

  /** A ticker holding the newest close there is has nothing more to fetch until the next close. */
  test('holds an Alpha Vantage ticker already on the newest close', () => {
    const record = fresh('alphavantage');

    record.tickers = { IBM: { lastFetchMs: evening - 3 * 60 * MINUTE_MS, lastAsOf: '2026-11-04' } };

    const result = pickTickers(record, 'alphavantage', limits, ['IBM'], false, evening);

    expect(result).toEqual([]);
  });

  /** A ticker that timed out has to come back on its own once its wait is up, ahead of the one that has waited longest. */
  test('takes the Alpha Vantage ticker left to ask again first once its wait is up', () => {
    const record = fresh('alphavantage');

    record.tickers = { X: { lastFetchMs: evening - 3 * 60 * MINUTE_MS, lastAsOf: '2026-11-03' }, Y: { lastFetchMs: evening - 5 * 60 * MINUTE_MS, lastAsOf: '2026-11-03' } };
    record.pending = ['X'];
    record.retryAtMs = evening - MINUTE_MS;

    const result = pickTickers(record, 'alphavantage', limits, ['Y', 'X'], false, evening);

    expect(result).toEqual(['X']);
  });

  /** A ticker refused for the day spent nothing on it, and a stamp would hold it until the evening after New York's next day. */
  test("leaves an Alpha Vantage ticker refused for the day unstamped, so it is due once New York's day turns", () => {
    const record = fresh('alphavantage');
    const friday = Date.UTC(2026, 10, 6, 23);
    const dayLimit = limited('Our standard API rate limit is 25 requests per day.');

    afterRound(record, 'alphavantage', limits, ['T1'], [dayLimit], [], 0, SAVED, friday);

    const result = [record.tickers.T1, pickTickers(record, 'alphavantage', limits, ['T1'], false, record.retryAtMs)];

    expect(result).toEqual([undefined, ['T1']]);
  });

  /** A retry asks only for what the last round lost, so the tickers it priced do not spend a call twice. */
  test('asks only for the tickers left to ask again on a retry', () => {
    const record = fresh('twelvedata');

    record.pending = ['MSFT'];

    const result = pickTickers(record, 'twelvedata', limitsFor('twelvedata', false), ['AAPL', 'MSFT'], true, NOON);

    expect(result).toEqual(['MSFT']);
  });
});

describe('liftStops', () => {
  /**
   * A save that changed nothing, or only moved a ticker, left the settings' fingerprint as it was, so a
   * key fixed on the provider's side kept showing INVALID KEY for a day, though the page says until you save.
   */
  test('lifts a stop after a bad key on any save', () => {
    const items = new Map<string, string>();
    const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };

    items.set(gateKey('finnhub'), JSON.stringify({ stop: 'INVALID KEY', stopAtMs: 1000, stopSettings: 'same' }));

    liftStops(storage, ['finnhub', 'yahoo']);

    const result = JSON.parse(items.get(gateKey('finnhub')) as string).stop;

    expect(result).toBe('');
  });
});
