/**
 * Stocks + Crypto's answer to the Pebble app, its prices as the standard `finance/stock` source.
 *
 * It serves two items from the one copy. `finance/stock` is the whole watchlist in the wearer's order,
 * stocks and crypto as they arranged them, so a face reading stocks shows the crypto too.
 * `finance/crypto` is the crypto entries alone, in their order within the list. The Pebble app asks
 * for each item in a run of its own, so the second run finds the copy the first one made, and asking
 * for crypto spends no calls of its own.
 *
 * Most runs answer from the copy of the last prices. Once the copy reaches the Refresh Interval, a run
 * fetches the stock tickers from the wearer's provider and the crypto tickers from Yahoo, side by side,
 * and keeps the result as the new copy. Each provider keeps to its own gates, so a run whose provider
 * is shut, waiting, or out of calls serves what the copy holds for it. When a round left tickers to ask
 * again after a short wait, the first run past the wait asks for those alone.
 *
 * The Pebble app holds a lock for the whole of a run, so two runs never overlap and each one sees
 * what the last one kept.
 */

import { readSettings, SETTINGS_KEY } from '../../paf/ts/plugin-app/settings';
import { stockInstance } from '../../paf/ts/plugin-app/stocks';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import type { SourceInstance } from '../../paf/ts/plugin-sources/types';
import { allowance, COUNTED, keepSent, keyPrint, loadLedger, saveLedger } from '../../paf/ts/stock/ledger';
import { fetchQuotes, UNANSWERED } from '../../paf/ts/stock/quotes';
import schedule from '../../paf/ts/stock/schedule';
import stockUtil from '../../paf/ts/stock/util';
import type { RequestFn, StockOpts, StockQuote } from '../../paf/ts/stock/util';
import { limitsFor } from '../limits';
import type { ProviderId, ProviderLimits } from '../limits';
import { DEFAULTS, SETTINGS_OPTIONS, YAHOO, providerOf } from '../settings';
import type { Provider } from '../settings';
import { fingerprint, isFresh, readCopy, saveCopy } from './copies';
import type { Copy, Entry } from './copies';
import { afterRound, gateFor, loadGate, pickTickers, saveGate } from './gates';
import { parseWatchlist, serializeWatchlist, watchlistOf } from '../watchlist';

/** What a run reads from, which a spec stands in for. */
export interface ServeContext {
  pebble: PluginPebble;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  /** The HTTP GET the providers fetch with, normally `pluginRequest`. */
  request: RequestFn;
  /** Reads the time now, normally `Date.now`. */
  clock?: () => number;
}

/** What a run answers with. */
export interface Answer {
  validUntilMs: number;
  instances: SourceInstance[];
}

/** One provider's part of a run: its tickers, and when the first of any it left to ask again is due. */
interface Priced {
  entries: Record<string, Entry>;
  retryAtMs: number;
  /** Whether any call went out for it this run. */
  fetched: boolean;
}

// the longest key any of the providers hands out, with room to spare
const KEY_MAX = 64;

// a quote with one of these keeps the copy's last good price, since none of them says the price is wrong
const KEEPS_KEPT = [...UNANSWERED, 'TIMEOUT', 'RATE LIMIT'];

// a run has 20 seconds, so calls made one after another stop starting after this long
// and the tickers left keep the copy's quote
const ONE_BY_ONE_MS = 10 * 1000;

/**
 * The settings, and whether the API keys in them could be read.
 *
 * A key the encrypted storage cannot read, such as while the phone's keystore is locked, reads as
 * empty, the same as one the wearer cleared. The strict read tells the two apart.
 */
async function readAll(context: ServeContext): Promise<{ settings: Record<string, unknown>; keysRead: boolean }> {
  try {
    return { settings: await readSettings(SETTINGS_OPTIONS, context.pebble, context.storage, true), keysRead: true };
  } catch {
    return { settings: await readSettings(SETTINGS_OPTIONS, context.pebble, context.storage), keysRead: false };
  }
}

/**
 * Whether the wearer has refused the provider's site.
 *
 * Only a refusal stops the fetch. A site still waiting on the wearer is fetched, since that fetch is
 * what puts the request in front of them in the Pebble app. A Pebble app with no permission check, or
 * a check that fails, fetches too, and the Pebble app still turns a refused site away itself.
 */
async function refused(pebble: PluginPebble, provider: Provider): Promise<boolean> {
  const permissions = pebble.permissions;

  if (!permissions || typeof permissions.query !== 'function') {
    return false;
  }

  try {
    return (await permissions.query(`Internet/${provider.domain}`)) === 'denied';
  } catch {
    return false;
  }
}

/** A quote with no price, carrying its ticker and a status word. */
function statusQuote(ticker: string, status: string): StockQuote {
  return { ...stockUtil.status(status), symbol: ticker };
}

/** The ledger's stamps for one provider and key, and whether the ledger counts that provider at all. */
interface Spent {
  counted: boolean;
  print: string;
  sentMs: number[];
}

/**
 * Fetches one ticker, stamping the call in the ledger as its request goes out.
 *
 * The stamp is saved at once, so a run the Pebble app ends partway still counts what it sent, and an
 * answer the provider code gives with no request, such as NO API KEY, counts nothing. A call that never
 * reached the host spent nothing either, so its stamp comes back off. A call that did reach it is
 * marked spent, so a TIMEOUT or a broken answer from it still sets a wait.
 */
async function fetchOne(context: ServeContext, provider: ProviderId, opts: StockOpts, symbol: string, spent: Spent, clock: () => number): Promise<StockQuote> {
  let reached = false;
  const request: RequestFn = (url, callback) => {
    const stamp = clock();

    if (spent.counted) {
      spent.sentMs.push(stamp);
      saveLedger(context.storage, provider, { keyPrint: spent.print, sentMs: spent.sentMs }, stamp);
    }

    context.request(url, (error, body) => {
      reached = error !== 'network error';

      if (spent.counted && !reached) {
        spent.sentMs.splice(spent.sentMs.lastIndexOf(stamp), 1);
        saveLedger(context.storage, provider, { keyPrint: spent.print, sentMs: spent.sentMs }, clock());
      }

      callback(error, body);
    });
  };
  const [quote] = await fetchQuotes([symbol], opts, request);

  return spent.counted && reached && !quote.ok ? { ...quote, spent: true } : quote;
}

/**
 * Fetches a round's tickers.
 *
 * Most providers take them all at once. Alpha Vantage refuses calls close together, so even on a paid
 * plan its calls go out one after another. They stop starting once the run has used most of its time,
 * or once one is refused for the burst limit, since the next would be refused too. Each ticker it never
 * fetched answers ERR, so it keeps the copy's quote and is asked for again with the refused one.
 */
async function fetchRound(context: ServeContext, provider: ProviderId, key: string, asked: string[], spent: Spent): Promise<StockQuote[]> {
  const clock = context.clock || Date.now;
  const opts = { provider, key };

  if (provider !== 'alphavantage') {
    return Promise.all(asked.map((symbol) => fetchOne(context, provider, opts, symbol, spent, clock)));
  }

  const results: StockQuote[] = [];
  const start = clock();
  let burst = false;

  for (const symbol of asked) {
    if (burst || clock() - start > ONE_BY_ONE_MS) {
      results.push(stockUtil.status('ERR'));
      continue;
    }

    const quote = await fetchOne(context, provider, opts, symbol, spent, clock);

    burst = quote.status === 'RATE LIMIT' && quote.limit === 'second';
    results.push(quote);
  }

  return results;
}

/**
 * One provider's tickers for this run, from a fetch where its gates allow one and from the copy where
 * they do not.
 *
 * The framework's ledger says how many calls fit inside a free plan now. A routine round with no room
 * fetches nothing. A save, or a round with room for some, asks for what fits, and the rest keep their
 * kept quote or read RATE LIMIT until the room opens. A ticker the provider never answered, timed
 * out, or rate limited keeps its kept quote too.
 */
async function priceWith(context: ServeContext, provider: Provider, key: string, limits: ProviderLimits, tickers: string[], force: boolean, retry: boolean, kept: Record<string, Entry>, settings: string, nowMs: number): Promise<Priced> {
  const entries: Record<string, Entry> = {};
  const id = provider.id;
  const marked = (ticker: string, status: string): Entry => ({ quote: statusQuote(ticker, status), source: provider.label });
  const keptOr = (ticker: string, status: string): Entry => kept[ticker] || marked(ticker, status);
  const settled = (): Priced => ({ entries, retryAtMs: 0, fetched: false });

  if (tickers.length === 0) {
    return settled();
  }

  if (provider.keySetting && !key) {
    tickers.forEach((ticker) => (entries[ticker] = marked(ticker, 'NO API KEY')));
    return settled();
  }

  const print = key ? keyPrint(key) : '';
  const counted = COUNTED.includes(id) && !limits.paid;
  const spent: Spent = { counted, print, sentMs: counted ? loadLedger(context.storage, id, print, nowMs) : [] };
  const record = loadGate(context.storage, id, print);
  const gate = gateFor(record, id, limits, force, spent.sentMs, settings, nowMs);
  let fetched = false;
  const waiting = (): Priced => ({ entries, retryAtMs: record.pending.length > 0 ? record.retryAtMs : 0, fetched });

  if (!gate.open) {
    // a key the provider turned away says so, rather than serving prices fetched with it
    tickers.forEach((ticker) => (entries[ticker] = gate.status === 'INVALID KEY' ? marked(ticker, gate.status) : keptOr(ticker, gate.status || 'NO DATA')));
    return waiting();
  }

  const wanted = pickTickers(record, id, limits, tickers, retry, nowMs);

  tickers.filter((ticker) => !wanted.includes(ticker)).forEach((ticker) => (entries[ticker] = keptOr(ticker, 'NO DATA')));

  if (wanted.length === 0) {
    return waiting();
  }

  if (await refused(context.pebble, provider)) {
    tickers.forEach((ticker) => (entries[ticker] = marked(ticker, 'NO PERMISSION')));
    return settled();
  }

  const room = counted ? allowance(id, spent.sentMs, wanted.length, force, false, nowMs) : { room: wanted.length, retryAtMs: 0 };

  if (room.room === 0 && !force) {
    wanted.forEach((ticker) => (entries[ticker] = keptOr(ticker, 'RATE LIMIT')));
    record.retryAtMs = Math.max(record.retryAtMs, room.retryAtMs);
    record.pending = wanted;
    saveGate(context.storage, id, record);
    return waiting();
  }

  const asked = wanted.slice(0, room.room);
  const leftOut = wanted.slice(room.room);

  leftOut.forEach((ticker) => (entries[ticker] = keptOr(ticker, 'RATE LIMIT')));

  // a wait that has passed is let go before the calls, so a run cut short cannot leave it to open the gate on the next
  if (record.retryAtMs && record.retryAtMs <= nowMs) {
    record.retryAtMs = 0;
    saveGate(context.storage, id, record);
  }

  const results = await fetchRound(context, id, key, asked, spent);

  // a round counts as a fetch only when a call reached the provider. one lost to the network spent
  // nothing, so the copy's time stays and the next run tries again rather than an interval later
  fetched = results.some((quote) => quote.ok || quote.spent === true || !UNANSWERED.includes(quote.status || ''));
  // the room for the tickers left out is worked out again from the stamps the round left
  const roomAtMs = leftOut.length > 0 ? allowance(id, keepSent(spent.sentMs, nowMs), leftOut.length, force, false, nowMs).retryAtMs : 0;

  afterRound(record, id, limits, asked, results, leftOut, roomAtMs, settings, nowMs);
  saveGate(context.storage, id, record);

  asked.forEach((ticker, index) => {
    const quote = results[index];

    if (quote.ok) {
      entries[ticker] = { quote, source: provider.label };
    } else if (KEEPS_KEPT.includes(quote.status || '') && kept[ticker]?.quote.ok) {
      entries[ticker] = kept[ticker];
    } else {
      entries[ticker] = marked(ticker, quote.status || 'ERR');
    }
  });

  return waiting();
}

/**
 * A fingerprint of the saved settings, with the watchlist in ticker order, so a save has the next run
 * fetch while moving a ticker does not. A move only changes the order served, which comes from the
 * settings on every run.
 */
function settingsPrint(storage: Pick<Storage, 'getItem'>): string {
  const text = storage.getItem(SETTINGS_KEY) || '';

  try {
    const settings = JSON.parse(text);
    const watchlist = settings && typeof settings === 'object' && !Array.isArray(settings) ? parseWatchlist(settings.WATCHLIST) : null;

    if (watchlist) {
      settings.WATCHLIST = serializeWatchlist(watchlist.slice().sort((one, other) => (one.ticker < other.ticker ? -1 : 1)));
      return fingerprint(JSON.stringify(settings));
    }
  } catch {
    // settings that do not read back are fingerprinted as they stand
  }

  return fingerprint(text);
}

/** The items the plugin serves, as a request names them. */
export type Item = 'stock' | 'crypto';

/**
 * A copy's answer for one item, each ticker in the watchlist's order with its provider and New York's
 * market state. The order comes from the settings rather than the copy, so moving a ticker on the page
 * shows at once and spends no call.
 */
function answerOf(copy: Copy, order: string[], refreshMs: number, nowMs: number): Answer {
  const market = schedule.marketPhase(nowMs);
  const due = copy.retryAtMs > 0 ? Math.min(copy.retryAtMs, copy.roundMs + refreshMs) : copy.roundMs + refreshMs;
  const tickers = order.filter((ticker) => copy.entries[ticker]);

  return {
    validUntilMs: due > nowMs ? due : nowMs + refreshMs,
    instances: tickers.map((ticker) => stockInstance(copy.entries[ticker].quote, ticker, { source: copy.entries[ticker].source, market })),
  };
}

/**
 * The prices as instances of one item.
 *
 * @param context Where the run reads from.
 * @param nowMs The time now.
 * @param item The item asked for, `stock` for every ticker or `crypto` for the crypto tickers alone.
 * @return The instances in the list's order, and when they next fall due.
 * @throws When no ticker could be priced and nothing was kept, so the Pebble app answers its error.
 */
export async function stockAnswer(context: ServeContext, nowMs: number, item: Item = 'stock'): Promise<Answer> {
  const { settings, keysRead } = await readAll(context);
  const provider = providerOf(settings.PROVIDER);
  const key = provider.keySetting ? String(settings[provider.keySetting] ?? '').trim().slice(0, KEY_MAX) : '';
  const watchlist = watchlistOf(settings);
  const own = watchlist.filter((entry) => entry.kind === 'stock').map((entry) => entry.ticker);
  const crypto = watchlist.filter((entry) => entry.kind === 'crypto').map((entry) => entry.ticker);
  const order = item === 'crypto' ? crypto : watchlist.map((entry) => entry.ticker);
  const refreshMs = (Number(settings.REFRESH) || Number(DEFAULTS.REFRESH)) * 60 * 1000;
  const paid = provider.paidSetting ? settings[provider.paidSetting] === true : false;
  const limits = limitsFor(provider.id, paid);
  // the priced tickers in the order the caps read them, so moving a ticker within them fetches nothing
  const lists = fingerprint(JSON.stringify([provider.id, own.slice(0, limits.tickerCap).sort(), crypto.slice().sort()]));
  const id = `${provider.id}-${limits.paid ? 'paid' : 'free'}-${key ? keyPrint(key) : ''}`;
  const kept = readCopy(context.storage);

  if (provider.keySetting && !keysRead) {
    // the key decides whether the copy is the wearer's, so without it the copy for the same lists
    // is served as it is and nothing is fetched until the keystore opens again
    if (kept && kept.lists === lists) {
      return answerOf(kept, order, refreshMs, nowMs);
    }

    throw new Error('the API key could not be read');
  }

  // a copy from another provider, key, or plan is dropped whole
  // one for other lists keeps its quotes for the tickers still listed, so a save fetches what is new
  // without the rest going blank
  const copy = kept && kept.id === id ? kept : null;
  const changed = !copy || copy.lists !== lists;
  // a fingerprint of the saved settings, so any save has the next run fetch, as far as the floors
  // allow, and lifts a stop after a bad key
  const saved = settingsPrint(context.storage);
  const fresh = Boolean(copy) && !changed && (copy as Copy).saved === saved && isFresh(copy as Copy, refreshMs, nowMs);
  // a retry runs once its wait is up, whether or not the copy is due, and asks only for the tickers
  // the last round left to ask again, so the ones it priced do not spend a second call
  const retry = Boolean(copy) && !changed && (copy as Copy).retryAtMs > 0 && nowMs >= (copy as Copy).retryAtMs;

  if (fresh && !retry) {
    return answerOf(copy as Copy, order, refreshMs, nowMs);
  }

  const tickers = { stocks: own, crypto };
  const cap = limits.tickerCap;
  const groups = new Map<ProviderId, { provider: Provider; tickers: string[] }>([[provider.id, { provider, tickers: tickers.stocks.slice(0, cap) }]]);

  // crypto always comes from Yahoo, so under Yahoo it joins the stocks in the same round
  groups.set(YAHOO.id, { provider: YAHOO, tickers: [...(groups.get(YAHOO.id)?.tickers || []), ...tickers.crypto] });

  // a run after a save that changed the lists fetches past the floors, the way a face does after a save
  // the counts still hold it to the plan
  const keptEntries = copy ? copy.entries : {};
  const priced = await Promise.all(
    [...groups.values()].map((group) => {
      const picked = group.provider === provider;

      return priceWith(context, group.provider, picked ? key : '', picked ? limits : limitsFor(group.provider.id, false), group.tickers, changed, retry, keptEntries, saved, nowMs);
    })
  );
  const entries: Record<string, Entry> = Object.assign({}, ...priced.map((part) => part.entries));

  // past the provider's cap, the wearer's plan has no room for the ticker
  tickers.stocks.slice(cap).forEach((ticker) => (entries[ticker] = { quote: statusQuote(ticker, 'NO ACCESS'), source: provider.label }));

  const served = watchlist.map((entry) => entry.ticker);
  const nothingAnswered = served.length > 0 && served.every((ticker) => !entries[ticker].quote.ok && UNANSWERED.includes(entries[ticker].quote.status || ''));

  if (nothingAnswered) {
    throw new Error('no provider could be reached');
  }

  const retries = priced.map((part) => part.retryAtMs).filter((at) => at > 0);
  // a retry run keeps the copy's own age, so the Refresh Interval still decides the next full round
  // a round that fetched nothing, all its providers held by their floors or waits, keeps the copy's
  // age, so the next fetch falls due when it would have and validUntilMs says so
  const anyFetched = priced.some((part) => part.fetched);
  const next: Copy = { id, lists, roundMs: copy && (retry || !anyFetched) ? copy.roundMs : nowMs, retryAtMs: retries.length > 0 ? Math.min(...retries) : 0, saved, order: served, entries: {} };

  served.forEach((ticker) => (next.entries[ticker] = entries[ticker]));
  saveCopy(context.storage, next);

  return answerOf(next, order, refreshMs, nowMs);
}

/**
 * Has the Pebble app ask Stocks + Crypto for its prices.
 *
 * @param context Where each run reads from.
 * @param clock Reads the time now, normally `Date.now`.
 */
export function handleSource(context: ServeContext, clock: () => number = Date.now): void {
  context.pebble.registerSourceHandler(async (request, respond) => {
    // anything but crypto is the full list, the one Pebble's own Stocks plugin serves
    const item: Item = request && request.item === 'crypto' ? 'crypto' : 'stock';

    try {
      respond.data(await stockAnswer({ clock, ...context }, clock(), item));
    } catch (error) {
      console.log(`Stocks + Crypto: the prices could not be served, ${error}`);
      respond.error('PLUGIN_UNAVAILABLE', String(error));
    }
  });
}
