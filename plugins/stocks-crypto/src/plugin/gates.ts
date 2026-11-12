/**
 * What Stocks + Crypto keeps per provider, on top of the framework's ledger, to hold each one under
 * its plan.
 *
 * The Pebble app runs the plugin cold, once per subscriber every five minutes, again after every save,
 * and again whenever a face starts reading. Nothing in memory lasts from one run to the next, so each
 * run reads what it needs from `localStorage` and writes it back before it answers. The framework's
 * ledger keeps the calls each key has sent, and each provider keeps a record of its own:
 *
 * * **The framework's quota stamps**, when it last fetched and the trading day of its last good quote,
 *   which `shouldThrottleStockFetch` spaces Twelve Data and Alpha Vantage by, the way a face does.
 *   Alpha Vantage's free key keeps a pair for each ticker, since the plugin fetches it one ticker a run.
 * * **The wait** a rate limit, a troubled call, or a full ledger left, and the tickers to ask for again
 *   once it is up, so a retry asks only for what was refused, lost, or left out.
 * * **A stop after a bad key**, when the provider turned away every ticker, which holds until the
 *   wearer saves a change or a day goes by.
 *
 * The record carries the fingerprint of the key it belongs to, so a different key starts afresh.
 */

import { ONE_A_SECOND_GAP_MS } from '../../paf/ts/stock/limits';
import { UNANSWERED, roundStamps } from '../../paf/ts/stock/quotes';
import schedule from '../../paf/ts/stock/schedule';
import type { StockQuote } from '../../paf/ts/stock/util';
import { zoneParts } from '../../paf/ts/pkjs/timezone';
import type { ProviderId, ProviderLimits } from '../limits';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** How long a stop after a bad key holds with no save, so a key fixed on the provider's side is tried again. */
export const STOP_HOLDS_MS = DAY_MS;

/** The part of `localStorage` the records use, which a spec stands in for. */
export type GateStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The framework's quota stamps. */
export interface Stamps {
  lastFetchMs: number;
  lastAsOf: string;
}

/** One provider's record, as kept between runs. */
export interface GateRecord extends Stamps {
  /** The fingerprint of the key the record belongs to, empty for a provider with no key. */
  key: string;
  /** Each ticker's own stamps, for a provider fetched one ticker a run. */
  tickers: Record<string, Stamps>;
  /** When to try again, or 0. */
  retryAtMs: number;
  /** The backoff the last troubled round left, which the next one doubles. */
  backoffMs: number;
  /** The tickers to ask for alone once the wait is up. */
  pending: string[];
  /** INVALID KEY once the provider turned away every ticker, or empty. */
  stop: string;
  /** When the stop was set. */
  stopAtMs: number;
  /** A fingerprint of the saved settings when the stop was set, so a save lifts it. */
  stopSettings: string;
}

/** Whether a provider can fetch this run, and if not, the status for a ticker with nothing kept. */
export interface Gate {
  open: boolean;
  status?: string;
}

/**
 * Where a provider's record is kept in `localStorage`.
 *
 * @param provider The provider.
 * @return Its storage key.
 */
export function gateKey(provider: ProviderId): string {
  return `stocks-crypto-gate-${provider}`;
}

/** True for a number a record can hold. */
function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The per ticker stamps that read back as stamps. */
function readTickers(saved: unknown): Record<string, Stamps> {
  const tickers: Record<string, Stamps> = {};

  if (saved && typeof saved === 'object') {
    for (const [ticker, stamps] of Object.entries(saved as Record<string, Stamps>)) {
      if (stamps && isTime(stamps.lastFetchMs) && typeof stamps.lastAsOf === 'string') {
        tickers[ticker] = { lastFetchMs: stamps.lastFetchMs, lastAsOf: stamps.lastAsOf };
      }
    }
  }

  return tickers;
}

/**
 * A provider's record, or a fresh one when there is none, it does not read back, or it belongs to
 * another key.
 *
 * @param storage Where the records are kept, normally `localStorage`.
 * @param provider The provider.
 * @param key The fingerprint of the key the run fetches with.
 * @return The record.
 */
export function loadGate(storage: GateStorage, provider: ProviderId, key: string): GateRecord {
  const empty: GateRecord = { key, lastFetchMs: 0, lastAsOf: '', tickers: {}, retryAtMs: 0, backoffMs: 0, pending: [], stop: '', stopAtMs: 0, stopSettings: '' };

  try {
    const saved = JSON.parse(storage.getItem(gateKey(provider)) || 'null');

    if (saved && saved.key === key && isTime(saved.lastFetchMs) && isTime(saved.retryAtMs) && isTime(saved.backoffMs)) {
      return {
        ...empty,
        lastFetchMs: saved.lastFetchMs,
        lastAsOf: typeof saved.lastAsOf === 'string' ? saved.lastAsOf : '',
        tickers: readTickers(saved.tickers),
        retryAtMs: saved.retryAtMs,
        backoffMs: saved.backoffMs,
        pending: Array.isArray(saved.pending) ? saved.pending.filter((ticker: unknown) => typeof ticker === 'string') : [],
        stop: typeof saved.stop === 'string' ? saved.stop : '',
        stopAtMs: isTime(saved.stopAtMs) ? saved.stopAtMs : 0,
        stopSettings: typeof saved.stopSettings === 'string' ? saved.stopSettings : '',
      };
    }
  } catch {
    // unreadable, so it starts again
  }

  return empty;
}

/**
 * Keeps a provider's record.
 *
 * @param storage Where the records are kept, normally `localStorage`.
 * @param provider The provider.
 * @param record The record.
 */
/**
 * Lifts every provider's stop after a bad key, for a save from the settings page. The page tells the
 * wearer a turned away key is left alone until they save, and a save that changes nothing, or only
 * moves a ticker, leaves the settings' fingerprint as it was, so the stop is lifted here rather than
 * by the fingerprint.
 *
 * @param storage Where the records are kept, normally `localStorage`.
 * @param providers The providers whose records to lift.
 */
export function liftStops(storage: GateStorage, providers: ProviderId[]): void {
  providers.forEach((provider) => {
    try {
      const saved = JSON.parse(storage.getItem(gateKey(provider)) as string);

      if (saved && typeof saved === 'object' && saved.stop) {
        storage.setItem(gateKey(provider), JSON.stringify({ ...saved, stop: '', stopAtMs: 0, stopSettings: '' }));
      }
    } catch (error) {
      // a record that cannot be read has no stop to lift
    }
  });
}

export function saveGate(storage: GateStorage, provider: ProviderId, record: GateRecord): void {
  try {
    storage.setItem(gateKey(provider), JSON.stringify(record));
  } catch (error) {
    console.log(`Stocks + Crypto: the ${provider} record could not be kept, ${error}`);
  }
}

/**
 * Whether a provider can fetch this run.
 *
 * A stop after a bad key wins while it holds. It lifts once the wearer saves a change, or once a day
 * has gone by, since a key can be fixed on the provider's side. The ledger and the floors bound what a
 * bad key spends before the next stop, so trying it again costs little.
 *
 * Then the framework's `shouldThrottleStockFetch`, which holds both the wait and the free plan's
 * floors. A forced round skips both, which a run asks for when the wearer's lists changed since the
 * last one, the way a face fetches after a save, and the ledger still holds it to the free plan. A
 * provider fetched one ticker a run checks the floors per ticker instead, in `pickTickers`, and a save
 * skips its wait the same way. It also waits until its last call is a second behind it, since the
 * plugin has no timers to space its calls and Alpha Vantage's free key turns away one closer than that.
 *
 * @param record The provider's record.
 * @param provider The provider.
 * @param limits The limits it keeps to.
 * @param force Whether to skip the floors.
 * @param sentMs The ledger's stamps of the calls it sent, oldest first.
 * @param settings A fingerprint of the saved settings.
 * @param nowMs The time now.
 * @return Whether it can fetch, and the status to show when it cannot.
 */
export function gateFor(record: GateRecord, provider: ProviderId, limits: ProviderLimits, force: boolean, sentMs: number[], settings: string, nowMs: number): Gate {
  const stopHolds = record.stop && record.stopSettings === settings && nowMs - record.stopAtMs >= 0 && nowMs - record.stopAtMs < STOP_HOLDS_MS;

  if (stopHolds) {
    return { open: false, status: record.stop };
  }

  const waiting = record.retryAtMs > nowMs;

  if (limits.oneAtATime) {
    const lastSentMs = sentMs.length > 0 ? sentMs[sentMs.length - 1] : 0;

    return (waiting && !force) || nowMs - lastSentMs < ONE_A_SECOND_GAP_MS ? { open: false, status: waiting ? 'RATE LIMIT' : undefined } : { open: true };
  }

  if (schedule.shouldThrottleStockFetch(provider, force, record.lastFetchMs, record.lastAsOf, nowMs, record.retryAtMs, limits.paid)) {
    return { open: false, status: waiting ? 'RATE LIMIT' : undefined };
  }

  return { open: true };
}

/** True when the record's wait is up and it has tickers left to ask for again. */
function retryDue(record: GateRecord, nowMs: number): boolean {
  return record.pending.length > 0 && record.retryAtMs > 0 && record.retryAtMs <= nowMs;
}

/**
 * The tickers a round wants, out of the ones the provider prices.
 *
 * A retry asks only for the tickers the last round left to ask again. Otherwise most providers want
 * them all. One fetched a ticker a run takes a ticker left to ask again first once its wait is up, and
 * otherwise the one waiting longest of those the framework's schedule lets through, leaving any already
 * holding the newest close it can have. A ticker with no stamp, such as one a save just added, goes
 * before the others.
 *
 * @param record The provider's record.
 * @param provider The provider.
 * @param limits The limits it keeps to.
 * @param tickers The tickers the provider prices, in the list's order.
 * @param retry Whether this run only asks again for the last round's tickers.
 * @param nowMs The time now.
 * @return The tickers it wants.
 */
export function pickTickers(record: GateRecord, provider: ProviderId, limits: ProviderLimits, tickers: string[], retry: boolean, nowMs: number): string[] {
  const pending = tickers.filter((ticker) => record.pending.includes(ticker));

  if (retry) {
    return pending.slice(0, limits.oneAtATime ? 1 : tickers.length);
  }

  if (!limits.oneAtATime) {
    return tickers;
  }

  if (pending.length > 0 && retryDue(record, nowMs)) {
    return pending.slice(0, 1);
  }

  const tradingDay = schedule.currentTradingDay(nowMs);
  const waited = (ticker: string) => record.tickers[ticker]?.lastFetchMs || 0;
  const due = tickers.filter((ticker) => {
    const stamps = record.tickers[ticker] || { lastFetchMs: 0, lastAsOf: '' };
    const current = Boolean(tradingDay) && stamps.lastAsOf >= tradingDay;

    return !current && !schedule.shouldThrottleStockFetch(provider, false, stamps.lastFetchMs, stamps.lastAsOf, nowMs);
  });

  return due.sort((one, other) => waited(one) - waited(other)).slice(0, 1);
}

/** The time New York's next day starts, or a day from now on a runtime that cannot read New York's clock. */
function nextNewYorkDay(nowMs: number): number {
  const parts = zoneParts('America/New_York', nowMs);

  if (!parts) {
    return nowMs + DAY_MS;
  }

  // New York's offset is whole hours, so its seconds are the same as UTC's
  const minutesLeft = 24 * 60 - (parts.hour * 60 + parts.minute);

  return nowMs + minutesLeft * MINUTE_MS - (nowMs % MINUTE_MS);
}

/** True for a ticker to ask for again once the wait is up: refused for a second or a minute, lost, or troubled. */
function askAgain(quote: StockQuote): boolean {
  return [...UNANSWERED, 'TIMEOUT'].includes(quote.status || '') || (quote.status === 'RATE LIMIT' && (quote.limit === 'second' || quote.limit === 'minute'));
}

/**
 * Moves a one-ticker-a-run provider's per ticker stamps.
 *
 * Only an answer that settles the ticker stamps it, a price or a word such as NO SYMBOL. A rate limit
 * of any kind, a call lost to the network, and a call that timed out or came back broken leave the
 * stamp alone, so the ticker is due again once the wait is up rather than at the next evening window.
 * A ticker that was already being asked for again and comes back troubled a second time is stamped,
 * so the schedule takes it over and the other tickers get their turns.
 */
function moveTickers(record: GateRecord, asked: string[], results: StockQuote[], retried: string[], nowMs: number): void {
  asked.forEach((ticker, index) => {
    const quote = results[index];
    const unsettled = quote.status === 'RATE LIMIT' || UNANSWERED.includes(quote.status || '') || quote.status === 'TIMEOUT';
    const troubledAgain = quote.spent && retried.includes(ticker) && quote.status !== 'RATE LIMIT';

    if (quote.ok) {
      record.tickers[ticker] = { lastFetchMs: nowMs, lastAsOf: quote.asOf || '' };
    } else if (!unsettled || troubledAgain) {
      record.tickers[ticker] = { lastFetchMs: nowMs, lastAsOf: record.tickers[ticker]?.lastAsOf || '' };
    }
  });
}

/**
 * Moves a provider's record on after a round.
 *
 * The stamps move by the framework's `roundStamps`, and the wait by its `roundWait`, the way the
 * framework's stock feature moves them. Only a one-ticker-a-run provider counts as leaving the time
 * alone for its troubled ticker, since only there does the next run ask for that ticker alone. For the
 * others a troubled ticker beside good quotes waits for the floor with the rest, as a face's does.
 * Tickers the ledger had no room for wait for the room to open. A ticker is asked for again on its own
 * once, so one that keeps failing goes back to the schedule rather than taking every retry.
 *
 * A stop is set only when the provider turned away every ticker the round asked for, since a single
 * mistyped ticker can come back INVALID KEY from some providers. Any other answer lifts it.
 *
 * Alpha Vantage's free key also waits for New York's next day after its daily limit. The framework
 * leaves that limit to the evening window, and each try there would only meet the same refusal.
 *
 * @param record The provider's record.
 * @param provider The provider.
 * @param limits The limits it keeps to.
 * @param asked The tickers the round fetched.
 * @param results Their quotes, in the same order.
 * @param leftOut The tickers the ledger had no room for.
 * @param roomAtMs When the ledger has room for them, or 0.
 * @param settings A fingerprint of the saved settings, kept with a stop so a save lifts it.
 * @param nowMs When the round finished.
 */
export function afterRound(record: GateRecord, provider: ProviderId, limits: ProviderLimits, asked: string[], results: StockQuote[], leftOut: string[], roomAtMs: number, settings: string, nowMs: number): void {
  const retried = asked.filter((ticker) => record.pending.includes(ticker));
  const badKey = results.length > 0 && results.every((quote) => quote.status === 'INVALID KEY');

  record.stop = badKey ? 'INVALID KEY' : '';
  record.stopAtMs = badKey ? nowMs : 0;
  record.stopSettings = badKey ? settings : '';

  const stamps = roundStamps(results, nowMs);
  const answered = stamps.lastFetchMs !== undefined;

  if (limits.oneAtATime) {
    moveTickers(record, asked, results, retried, nowMs);
  } else {
    if (answered) {
      record.lastFetchMs = nowMs;
    }

    if (stamps.lastAsOf !== undefined) {
      record.lastAsOf = stamps.lastAsOf;
    }
  }

  const wait = schedule.roundWait(provider, results, answered, limits.oneAtATime, record.backoffMs, nowMs, limits.paid);

  if (wait) {
    record.retryAtMs = wait.retryAtMs;
    record.backoffMs = wait.backoffMs;
  }

  const dailyLimit = provider === 'alphavantage' && !limits.paid && results.some((quote) => quote.status === 'RATE LIMIT' && quote.limit !== 'second');

  if (dailyLimit) {
    record.retryAtMs = nextNewYorkDay(nowMs);
  }

  if (leftOut.length > 0 && roomAtMs > record.retryAtMs) {
    record.retryAtMs = roomAtMs;
  }

  const again = asked.filter((ticker, index) => askAgain(results[index]) && !retried.includes(ticker));

  record.pending = record.retryAtMs > nowMs ? [...again, ...leftOut] : [];
}
