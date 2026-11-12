/**
 * Specs for runs of Stocks + Crypto from end to end, against a stand-in for the phone and the four
 * providers' sites.
 *
 * What is pinned here is what a wearer sees and what a key pays for it. The order the tickers are
 * served in, crypto going to Yahoo whatever the stock provider is, a ticker the provider cannot price
 * going out with its status word, and a refused site never being fetched. Then the copy, which is what
 * keeps most runs off the network, and the gates, which hold Twelve Data and Alpha Vantage under their
 * free plans whatever made the Pebble app run the plugin, and leave a paid plan to the provider's word.
 *
 * The Pebble app runs the plugin every five minutes per subscriber, after every save, and whenever a
 * face starts reading, so the worst days below run it every five minutes and twice more each hour.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in New York, with the market open.
 */

import { describe, test, expect } from 'vitest';
import { SETTINGS_KEY } from '../../paf/ts/plugin-app/settings';
import { keyPrint, LEDGER_KEY } from '../../paf/ts/stock/ledger';
import { gateKey } from './gates';
import { fakePhone, run, shown } from './testing/fake-phone';
import type { FakePhone } from './testing/fake-phone';

/** A moment on New York's clock, which is UTC-5 then, on Wednesday 4 November 2026 or another day that month. */
function ny(hour: number, minute = 0, day = 4): number {
  return Date.UTC(2026, 10, day, hour + 5, minute);
}

const NOON = ny(12);
const MINUTE_MS = 60 * 1000;

const EIGHT_STOCKS = 'AAPL, MSFT, NVDA, AMZN, GOOG, META, TSLA, NFLX';
const EIGHT_CRYPTO = 'BTC-USD, ETH-USD, SOL-USD, XRP-USD, ADA-USD, DOGE-USD, DOT-USD, LTC-USD';

// Alpha Vantage's own words when two calls land inside a second, which name its daily limit too
const AV_BURST = {
  error: null,
  body: JSON.stringify({
    Information:
      'Thank you for using Alpha Vantage! Please consider spreading out your free API requests more sparingly (1 request per second). You may subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to lift the free key rate limit (25 requests per day), raise the per-second burst limit, and instantly unlock all premium endpoints',
  }),
};

// Alpha Vantage's own words once a key's 25 for the day are spent
const AV_DAY = { error: null, body: JSON.stringify({ Information: 'We have detected your API key and our standard API rate limit is 25 requests per day.' }) };

/** Runs the plugin every five minutes over a stretch of time, a few seconds past each, as the Pebble app does. */
async function runEvery5(phone: FakePhone, fromMs: number, toMs: number, before: (atMs: number) => void = () => undefined): Promise<void> {
  for (let atMs = fromMs; atMs < toMs; atMs += 5 * MINUTE_MS) {
    before(atMs);
    await run(phone, atMs + 2000);
  }
}

const TD_MINUTE = { error: null, body: JSON.stringify({ code: 429, message: 'You have run out of API credits for the current minute.', status: 'error' }) };

/** A watchlist as the page saves it, the stocks given and then the crypto, each a comma list. */
function watch(stocks: string, crypto = ''): string {
  const entries = (text: string, kind: string) => text.split(',').map((ticker) => ticker.trim()).filter(Boolean).map((ticker) => ({ ticker, kind }));

  return JSON.stringify([...entries(stocks, 'stock'), ...entries(crypto, 'crypto')]);
}

/** The calls one provider's site got. */
function callsTo(phone: FakePhone, host: string) {
  return phone.calls.filter((call) => call.host === host);
}

/** The most calls a site got inside any 60 seconds. */
function busiestMinute(phone: FakePhone, host: string): number {
  const times = callsTo(phone, host).map((call) => call.atMs);

  return Math.max(0, ...times.map((start) => times.filter((at) => at >= start && at - start < MINUTE_MS).length));
}

/**
 * Runs the plugin through one New York day the way the Pebble app can: every five minutes from
 * midnight, plus a run two minutes past each hour for a save's refresh and one three minutes past for
 * a face starting to read. A save can change the settings first.
 */
async function runADay(phone: FakePhone, beforeEachHour: (hour: number) => void = () => undefined): Promise<void> {
  for (let minutes = 0; minutes < 24 * 60; minutes += 5) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;

    await run(phone, ny(hour, minute));

    if (minute === 0) {
      beforeEachHour(hour);
      await run(phone, ny(hour, 2));
      await run(phone, ny(hour, 3));
    }
  }
}

/** A phone set up the most a wearer can ask of a provider: 8 stock tickers and 8 crypto. */
function busiestPhone(provider: string, keySetting: string): FakePhone {
  return fakePhone({ PROVIDER: provider, WATCHLIST: watch(EIGHT_STOCKS, EIGHT_CRYPTO), REFRESH: '5' }, { [keySetting]: 'free-key' });
}

/** Saves new settings over the old, the way the settings page does. */
function save(phone: FakePhone, changes: Record<string, unknown>): void {
  const saved = JSON.parse(phone.items.get(SETTINGS_KEY) || '{}');

  phone.items.set(SETTINGS_KEY, JSON.stringify({ ...saved, ...changes }));
}

/** The ledger's stamps for one provider and key, as kept. */
function sentOf(phone: FakePhone, provider: string, key: string): number[] {
  return (JSON.parse(phone.items.get(LEDGER_KEY) || '{}')[provider] || {})[keyPrint(key)] || [];
}

/** A provider's record as kept. */
function recordOf(phone: FakePhone, provider: 'yahoo' | 'finnhub' | 'twelvedata' | 'alphavantage') {
  return JSON.parse(phone.items.get(gateKey(provider)) || '{}');
}

describe('the tickers served', () => {
  /** A face shows the top of the list, so the stock tickers the wearer typed have to lead. */
  test('serves the stock tickers, then the crypto ones', async () => {
    const phone = fakePhone({ PROVIDER: 'finnhub', WATCHLIST: watch('AAPL, MSFT', 'BTC-USD') }, { FINNHUB_KEY: 'key' });

    const result = shown(await run(phone, NOON));

    expect(result).toEqual(['AAPL 100.00 Finnhub', 'MSFT 100.00 Finnhub', 'BTC-USD $100.00 Yahoo']);
  });

  /** Crypto spelt Yahoo's way would be a different ticker or none at the other three, so it has to go to Yahoo alone. */
  test.each([
    ['finnhub', 'FINNHUB_KEY'],
    ['twelvedata', 'TWELVEDATA_KEY'],
    ['alphavantage', 'ALPHAVANTAGE_KEY'],
  ])('fetches crypto from Yahoo under %s', async (provider, keySetting) => {
    const phone = fakePhone({ PROVIDER: provider, WATCHLIST: watch('AAPL', 'BTC-USD') }, { [keySetting]: 'key' });

    await run(phone, NOON);
    const result = phone.calls.map((call) => `${call.symbol} ${call.host}`);

    expect(result).toEqual([expect.stringMatching(/^AAPL /), 'BTC-USD query1.finance.yahoo.com']);
  });

  /** Finnhub's free plan refuses ^GSPC, and the wearer has to be told why the price is missing. */
  test('serves NO ACCESS for a ticker the provider refuses', async () => {
    const phone = fakePhone({ PROVIDER: 'finnhub', WATCHLIST: watch('^GSPC, AAPL') }, { FINNHUB_KEY: 'key' });

    phone.replies['finnhub.io ^GSPC'] = { error: 'http 403' };

    const result = shown(await run(phone, NOON));

    expect(result).toEqual(['^GSPC NO ACCESS Finnhub', 'AAPL 100.00 Finnhub']);
  });

  /** A fifth ticker would take Alpha Vantage's free day past what it allows, so it says so rather than going blank. */
  test("serves NO ACCESS on tickers past Alpha Vantage's 4", async () => {
    const phone = fakePhone({ PROVIDER: 'alphavantage', WATCHLIST: watch('IBM, AAPL, MSFT, NVDA, AMZN') }, { ALPHAVANTAGE_KEY: 'key' });

    const result = shown(await run(phone, NOON)).slice(4);

    expect(result).toEqual(['AMZN NO ACCESS Alpha Vantage']);
  });

  /** A fetch to a site the wearer turned down fails anyway, and saying NO PERMISSION tells them what to change. */
  test('serves NO PERMISSION with no fetch when the wearer refused the site', async () => {
    const phone = fakePhone({ PROVIDER: 'finnhub', WATCHLIST: watch('AAPL', 'BTC-USD') }, { FINNHUB_KEY: 'key' });

    phone.permissions['Internet/finnhub.io'] = 'denied';

    const answer = await run(phone, NOON);

    expect([shown(answer), phone.calls.map((call) => call.host)]).toEqual([['AAPL NO PERMISSION Finnhub', 'BTC-USD $100.00 Yahoo'], ['query1.finance.yahoo.com']]);
  });

  /** An error leaves a face on what it last had, where a list of NET ERROR would blank every slot. */
  test("answers the runtime's error when nothing could be reached and nothing was kept", async () => {
    const phone = fakePhone({ PROVIDER: 'yahoo', WATCHLIST: watch('AAPL') });

    phone.replies['query1.finance.yahoo.com'] = { error: 'network error' };

    const result = await run(phone, NOON);

    expect(result).toBe('PLUGIN_UNAVAILABLE');
  });

  /** A blip must not blank a price the plugin already had. */
  test('keeps the last good quote for a ticker the provider did not answer', async () => {
    const phone = fakePhone({ PROVIDER: 'yahoo', WATCHLIST: watch('AAPL') });

    await run(phone, NOON);
    phone.replies['query1.finance.yahoo.com'] = { error: 'network error' };

    const result = shown(await run(phone, NOON + 5 * MINUTE_MS));

    expect(result).toEqual(['AAPL $100.00 Yahoo']);
  });

  /**
   * A round lost to the network counted as a fetch, so the copy's time moved and the phone back a few
   * minutes later waited out a whole Refresh Interval with the old prices.
   */
  test('fetches again on the next run after a round lost to the network', async () => {
    const phone = fakePhone({ PROVIDER: 'yahoo', WATCHLIST: watch('AAPL'), REFRESH: '60' });

    await run(phone, NOON);
    phone.replies['query1.finance.yahoo.com'] = { error: 'network error' };
    await run(phone, NOON + 60 * MINUTE_MS);
    delete phone.replies['query1.finance.yahoo.com'];
    await run(phone, NOON + 65 * MINUTE_MS);

    const result = callsTo(phone, 'query1.finance.yahoo.com').length;

    expect(result).toBe(3);
  });

  /** A Yahoo block can last a day, and RATE LIMIT in every slot all that time tells the wearer less than the last prices do. */
  test('keeps serving the last good prices while Yahoo is rate limiting', async () => {
    const phone = fakePhone({ PROVIDER: 'yahoo', WATCHLIST: watch('AAPL') });

    await run(phone, NOON);
    phone.replies['query1.finance.yahoo.com'] = { error: 'http 429', body: 'Too Many Requests' };

    const answers = [shown(await run(phone, NOON + 5 * MINUTE_MS)), shown(await run(phone, NOON + 10 * MINUTE_MS))];

    expect([answers, phone.calls.length]).toEqual([[['AAPL $100.00 Yahoo'], ['AAPL $100.00 Yahoo']], 2]);
  });

  /** Reading another stock plugin would run its own fetches on every round, so the plugin keeps to its own providers. */
  test("never reads another plugin's source", async () => {
    const phone = fakePhone({ PROVIDER: 'yahoo', WATCHLIST: watch('AAPL') });

    await run(phone, NOON);
    await run(phone, NOON + 5 * MINUTE_MS);
    const result = phone.otherPlugins;

    expect(result).toBe(0);
  });
});

describe('the two items', () => {
  /** The wearer arranged the list for the face, so `finance/stock` has to keep their order, crypto where they put it. */
  test('serves the whole watchlist on finance/stock in the order the wearer arranged it', async () => {
    const list = JSON.stringify([{ ticker: 'BTC-USD', kind: 'crypto' }, { ticker: 'AAPL', kind: 'stock' }, { ticker: 'ETH-USD', kind: 'crypto' }]);
    const phone = fakePhone({ PROVIDER: 'finnhub', WATCHLIST: list }, { FINNHUB_KEY: 'key' });

    const result = shown(await run(phone, NOON));

    expect(result).toEqual(['BTC-USD $100.00 Yahoo', 'AAPL 100.00 Finnhub', 'ETH-USD $100.00 Yahoo']);
  });

  /** A face reading crypto wants coins, not the wearer's stocks, and in the order they put the coins. */
  test('serves only the crypto entries on finance/crypto, in their order', async () => {
    const list = JSON.stringify([{ ticker: 'ETH-USD', kind: 'crypto' }, { ticker: 'AAPL', kind: 'stock' }, { ticker: 'BTC-USD', kind: 'crypto' }]);
    const phone = fakePhone({ PROVIDER: 'finnhub', WATCHLIST: list }, { FINNHUB_KEY: 'key' });

    const result = shown(await run(phone, NOON, undefined, 'crypto'));

    expect(result).toEqual(['ETH-USD $100.00 Yahoo', 'BTC-USD $100.00 Yahoo']);
  });

  /** The Pebble app runs the plugin once per item, and the second run must serve the first one's prices rather than fetch them again. */
  test('serves both items from one round of calls', async () => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', WATCHLIST: watch('AAPL, MSFT', 'BTC-USD') }, { TWELVEDATA_KEY: 'key' });

    await run(phone, NOON);
    await run(phone, NOON + 1000, undefined, 'crypto');
    const result = phone.calls.map((call) => call.symbol);

    expect(result).toEqual(['AAPL', 'MSFT', 'BTC-USD']);
  });

  /** On Yahoo no floor holds a fetch back, so a reorder that made the copy stale spent a full round. */
  test('serves a new order on Yahoo with no fetch, inside the Refresh Interval', async () => {
    const phone = fakePhone({ PROVIDER: 'yahoo', WATCHLIST: watch('AAPL, MSFT', 'BTC-USD'), REFRESH: '60' });

    await run(phone, NOON);
    save(phone, { WATCHLIST: JSON.stringify([{ ticker: 'BTC-USD', kind: 'crypto' }, { ticker: 'MSFT', kind: 'stock' }, { ticker: 'AAPL', kind: 'stock' }]) });

    const answer = await run(phone, NOON + 20 * MINUTE_MS);

    expect([shown(answer), phone.calls.length]).toEqual([['BTC-USD $100.00 Yahoo', 'MSFT $100.00 Yahoo', 'AAPL $100.00 Yahoo'], 3]);
  });

  /** A round whose provider was held fetched nothing, and taking it as a fetch pushed every later one back. */
  test('keeps the copy age when a round fetches nothing', async () => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', WATCHLIST: watch('AAPL'), REFRESH: '30' }, { TWELVEDATA_KEY: 'key' });

    await runEvery5(phone, NOON, NOON + 95 * MINUTE_MS, (atMs) => atMs === NOON + 10 * MINUTE_MS && save(phone, { TWELVEDATA_PAID: false }));
    const result = phone.calls.map((call) => Math.round((call.atMs - NOON) / MINUTE_MS));

    expect(result).toEqual([0, 30, 60, 90]);
  });

  /** Moving a ticker on the page is no reason to spend a call, and it has to show at once. */
  test('serves a new order straight away with no fetch', async () => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', WATCHLIST: watch('AAPL, MSFT') }, { TWELVEDATA_KEY: 'key' });

    await run(phone, NOON);
    save(phone, { WATCHLIST: watch('MSFT, AAPL') });

    const answer = await run(phone, NOON + MINUTE_MS);

    expect([shown(answer), phone.calls.length]).toEqual([['MSFT $100.00 Twelve Data', 'AAPL $100.00 Twelve Data'], 2]);
  });
});

describe('the copy', () => {
  /** The Pebble app runs the plugin far more often than every 5 minutes, and each of those must not fetch. */
  test('serves the copy while it is fresh, and fetches once it is due', async () => {
    const phone = fakePhone({ PROVIDER: 'yahoo', WATCHLIST: watch('AAPL') });

    await run(phone, NOON);
    await run(phone, NOON + 2 * MINUTE_MS);
    const fresh = phone.calls.length;

    await run(phone, NOON + 5 * MINUTE_MS);

    expect([fresh, phone.calls.length]).toEqual([1, 2]);
  });

  /** Prices fetched with a key the wearer replaced, or for tickers they removed, must not stay on the watch. */
  test.each([
    ['the key', { secret: 'new-key' }],
    ['the tickers', { WATCHLIST: watch('MSFT') }],
    ['the provider', { PROVIDER: 'yahoo' }],
  ])('fetches again after a save that changes %s', async (_label, change) => {
    const phone = fakePhone({ PROVIDER: 'finnhub', WATCHLIST: watch('AAPL') }, { FINNHUB_KEY: 'old-key' });

    await run(phone, NOON);
    const { secret, ...settings } = change as Record<string, unknown>;

    if (secret) {
      phone.secrets.FINNHUB_KEY = String(secret);
    }

    save(phone, settings);

    await run(phone, NOON + MINUTE_MS);
    const result = phone.calls.length;

    expect(result).toBe(2);
  });

  /** A copy that kept the key itself would put a secret in plain storage. */
  test('keeps no API key in plain storage', async () => {
    const phone = fakePhone({ PROVIDER: 'finnhub', WATCHLIST: watch('AAPL') }, { FINNHUB_KEY: 'very-secret-key' });

    await run(phone, NOON);
    const result = [...phone.items.values()].some((value) => value.includes('very-secret-key'));

    expect(result).toBe(false);
  });
});

describe('the gates', () => {
  /** A free Twelve Data key allows 800 calls a day, so it waits 15 minutes between rounds while the market is open. */
  test('fetches Twelve Data again only once 15 minutes have passed with the market open', async () => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', WATCHLIST: watch('AAPL') }, { TWELVEDATA_KEY: 'key' });
    const rounds: number[] = [];

    for (const minute of [0, 5, 10, 15]) {
      const before = phone.calls.length;

      await run(phone, ny(12, minute));
      rounds.push(phone.calls.length - before);
    }

    expect(rounds).toEqual([1, 0, 0, 1]);
  });

  /** Alpha Vantage only has the close after the bell, so a call in the afternoon spends one of its 25 for nothing new. */
  test('holds Alpha Vantage through the afternoon once it has a quote, and tries again after the close', async () => {
    const phone = fakePhone({ PROVIDER: 'alphavantage', WATCHLIST: watch('IBM') }, { ALPHAVANTAGE_KEY: 'key' });

    await run(phone, NOON);
    await run(phone, ny(15, 55));
    const afternoon = phone.calls.length;

    await run(phone, ny(16));

    expect([afternoon, phone.calls.length]).toEqual([1, 2]);
  });

  /** A run the Pebble app ends partway must not forget the calls, or the next run spends them again. */
  test('counts the calls before they go out', async () => {
    const phone = fakePhone({ PROVIDER: 'alphavantage', WATCHLIST: watch('IBM') }, { ALPHAVANTAGE_KEY: 'key' });
    let counted = -1;

    phone.onCall = () => (counted = sentOf(phone, 'alphavantage', 'key').length);

    await run(phone, NOON);

    expect(counted).toBe(1);
  });

  /** A call that never left the phone spent nothing, so a network that drops out must not eat the free day. */
  test('takes the count back off a call lost to the network', async () => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', WATCHLIST: watch('AAPL, MSFT') }, { TWELVEDATA_KEY: 'key' });

    phone.replies['api.twelvedata.com MSFT'] = { error: 'network error' };

    await run(phone, NOON);
    const result = sentOf(phone, 'twelvedata', 'key').length;

    expect(result).toBe(1);
  });

  /** A timed out call may have landed and been counted, so it keeps its count, and the slot keeps the last good price. */
  test('keeps the count and the last good price for a call that timed out', async () => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', WATCHLIST: watch('AAPL') }, { TWELVEDATA_KEY: 'key' });

    await run(phone, NOON);
    phone.replies['api.twelvedata.com'] = { error: 'timeout' };

    const answer = await run(phone, NOON + 15 * MINUTE_MS);

    expect([shown(answer), sentOf(phone, 'twelvedata', 'key').length]).toEqual([['AAPL $100.00 Twelve Data'], 2]);
  });

  /** A wait kept only after the answer would be lost to a run that ends there, and the next run would meet the limit again. */
  test('keeps the wait after a rate limit before it answers', async () => {
    const phone = fakePhone({ PROVIDER: 'finnhub', WATCHLIST: watch('AAPL') }, { FINNHUB_KEY: 'key' });

    phone.replies['finnhub.io'] = { error: 'http 429' };
    let waitUntil = 0;

    await run(phone, NOON, () => (waitUntil = recordOf(phone, 'finnhub').retryAtMs));

    expect(waitUntil).toBe(NOON + 15 * MINUTE_MS);
  });

  /** Asking again for every ticker after a minute's limit would spend the calls the others already got. */
  test("asks Twelve Data again only for the tickers its minute's limit refused", async () => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', WATCHLIST: watch('AAPL, MSFT') }, { TWELVEDATA_KEY: 'key' });

    phone.replies['api.twelvedata.com MSFT'] = TD_MINUTE;
    await run(phone, NOON);
    delete phone.replies['api.twelvedata.com MSFT'];

    const answer = await run(phone, NOON + 2 * MINUTE_MS);

    expect([phone.calls.map((call) => call.symbol), shown(answer)]).toEqual([['AAPL', 'MSFT', 'MSFT'], ['AAPL $100.00 Twelve Data', 'MSFT $100.00 Twelve Data']]);
  });

  /** A key the provider turned away fails on every call, so fetching again only spends the wearer's runs. */
  test('stops fetching after INVALID KEY until the key changes', async () => {
    const phone = fakePhone({ PROVIDER: 'finnhub', WATCHLIST: watch('AAPL') }, { FINNHUB_KEY: 'bad' });

    phone.replies['finnhub.io'] = { error: 'http 401' };

    await run(phone, NOON);
    const answer = await run(phone, NOON + 10 * MINUTE_MS);
    const stopped = phone.calls.length;

    phone.secrets.FINNHUB_KEY = 'good';
    delete phone.replies['finnhub.io'];
    await run(phone, NOON + 11 * MINUTE_MS);

    expect([shown(answer), stopped, phone.calls.length]).toEqual([['AAPL INVALID KEY Finnhub'], 1, 2]);
  });
});

describe('a ticker that is not stuck', () => {
  /** Stamped with the time it timed out, a Saturday morning ticker would show TIMEOUT until Monday evening. */
  test('asks Alpha Vantage again for a ticker that timed out once its wait is up, even on a weekend', async () => {
    const phone = fakePhone({ PROVIDER: 'alphavantage', WATCHLIST: watch('X') }, { ALPHAVANTAGE_KEY: 'key' });

    phone.replies['www.alphavantage.co'] = { error: 'timeout' };
    await run(phone, ny(10, 0, 7));
    delete phone.replies['www.alphavantage.co'];

    await runEvery5(phone, ny(10, 5, 7), ny(10, 20, 7));
    const result = phone.calls.map((call) => call.atMs);

    expect(result).toEqual([ny(10, 0, 7), ny(10, 15, 7) + 2000]);
  });

  /** A ticker the key's spent day refused was never priced, and stamped it would wait for the evening after New York's next day. */
  test("asks Alpha Vantage again for a ticker refused for the day once New York's day turns", async () => {
    const phone = fakePhone({ PROVIDER: 'alphavantage', WATCHLIST: watch('T1') }, { ALPHAVANTAGE_KEY: 'key' });

    await runEvery5(phone, ny(18, 0, 6), ny(0, 10, 7), (atMs) => (phone.replies['www.alphavantage.co'] = atMs < ny(0, 0, 7) ? AV_DAY : 'ok'));
    const result = phone.calls.map((call) => call.atMs);

    expect(result).toEqual([ny(18, 0, 6) + 2000, ny(0, 0, 7) + 2000]);
  });

  /** Twelve Data answers a mistyped ticker as a bad key, and that must not take the wearer's other prices off the watch. */
  test('keeps fetching the other tickers when one answers INVALID KEY', async () => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', WATCHLIST: watch('AAPL, BAD') }, { TWELVEDATA_KEY: 'key' });

    phone.replies['api.twelvedata.com BAD'] = { error: 'http 400', body: JSON.stringify({ code: 400, status: 'error', message: 'There is an error in the query.' }) };
    await run(phone, NOON);

    const answer = await run(phone, NOON + 15 * MINUTE_MS);

    expect([shown(answer), phone.calls.length]).toEqual([['AAPL $100.00 Twelve Data', 'BAD INVALID KEY Twelve Data'], 4]);
  });

  /** A wearer who fixed the key on the provider's site saves the page to try it again, and the stop must not outlast that. */
  test('tries a key every ticker turned away again after any save', async () => {
    const phone = fakePhone({ PROVIDER: 'finnhub', WATCHLIST: watch('AAPL') }, { FINNHUB_KEY: 'key' });

    phone.replies['finnhub.io'] = { error: 'http 401' };
    await run(phone, NOON);
    delete phone.replies['finnhub.io'];
    save(phone, { REFRESH: '10' });

    const answer = await run(phone, NOON + 5 * MINUTE_MS);

    expect([shown(answer), phone.calls.length]).toEqual([['AAPL 100.00 Finnhub'], 2]);
  });

  /** One ticker timing out must not bring all 8 back every 15 minutes, which on a Saturday is 12 times the floor's 8 rounds. */
  test('keeps Twelve Data to its floor with one ticker timing out all day', async () => {
    const phone = busiestPhone('twelvedata', 'TWELVEDATA_KEY');

    phone.replies['api.twelvedata.com NFLX'] = { error: 'timeout' };

    await runEvery5(phone, Date.UTC(2026, 10, 7), Date.UTC(2026, 10, 8));
    const result = callsTo(phone, 'api.twelvedata.com').length;

    expect(result).toBe(64);
  });

  /** The retry has to ask only for what was refused whenever the Pebble app next runs the plugin, not only at the moment it named. */
  test("asks Twelve Data again only for the tickers its minute's limit refused, at the next five minute run", async () => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', WATCHLIST: watch(EIGHT_STOCKS) }, { TWELVEDATA_KEY: 'key' });

    ['TSLA', 'NFLX'].forEach((ticker) => (phone.replies[`api.twelvedata.com ${ticker}`] = TD_MINUTE));
    await run(phone, NOON);
    ['TSLA', 'NFLX'].forEach((ticker) => delete phone.replies[`api.twelvedata.com ${ticker}`]);

    await run(phone, NOON + 5 * MINUTE_MS);
    const result = phone.calls.slice(8).map((call) => call.symbol);

    expect(result).toEqual(['TSLA', 'NFLX']);
  });
});

describe('the worst day', () => {
  /**
   * 25 calls a day is all Alpha Vantage's free key has. At its most, 8 tickers, a run every five
   * minutes and two more each hour, the plugin prices 4 tickers one at a time. Each costs one call
   * the first time it is seen and three after the close, when the close never comes in. That is 16,
   * with never more than one in a minute.
   */
  test("spends 16 of Alpha Vantage's 25 daily calls at most", async () => {
    const phone = busiestPhone('alphavantage', 'ALPHAVANTAGE_KEY');

    await runADay(phone);
    const result = [callsTo(phone, 'www.alphavantage.co').length, busiestMinute(phone, 'www.alphavantage.co')];

    expect(result).toEqual([16, 1]);
  });

  /** A wearer saving a new ticker every hour has each new one fetched, and the count still stops at 25. */
  test('stops Alpha Vantage at 25 calls a day however often the tickers change', async () => {
    const phone = busiestPhone('alphavantage', 'ALPHAVANTAGE_KEY');

    await runADay(phone, (hour) => save(phone, { WATCHLIST: watch(`X${hour}, ${EIGHT_STOCKS}`) }));
    const result = [callsTo(phone, 'www.alphavantage.co').length, busiestMinute(phone, 'www.alphavantage.co')];

    expect(result).toEqual([25, 1]);
  });

  /**
   * Twelve Data's free key allows 8 calls a minute and 800 a day. At its most the plugin prices 8
   * tickers in 32 rounds: four while the market is shut before the open, 26 while it is open, and two
   * in the evening. That is 256, with never more than 8 in a minute.
   */
  test("spends 256 of Twelve Data's 800 daily calls at most", async () => {
    const phone = busiestPhone('twelvedata', 'TWELVEDATA_KEY');

    await runADay(phone);
    const result = [callsTo(phone, 'api.twelvedata.com').length, busiestMinute(phone, 'api.twelvedata.com')];

    expect(result).toEqual([256, 8]);
  });

  /** A save every hour that changes the tickers forces a round each time. The day comes to 368 of the 800, and no minute goes past 8. */
  test('keeps Twelve Data to 8 calls a minute however often the tickers change', async () => {
    const phone = busiestPhone('twelvedata', 'TWELVEDATA_KEY');

    await runADay(phone, (hour) => save(phone, { WATCHLIST: watch(`X${hour}, ${EIGHT_STOCKS}`) }));
    const result = [callsTo(phone, 'api.twelvedata.com').length, busiestMinute(phone, 'api.twelvedata.com')];

    expect(result).toEqual([368, 8]);
  });
});

describe('a paid plan', () => {
  /** A paid Twelve Data key allows far more than 8 a minute, and a save straight after a round should not wait for the minute. */
  test.each([
    [false, 8],
    [true, 16],
  ])('with Paid Plan %s, fetches a save straight after a round in the same minute, %i calls', async (paid, calls) => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', TWELVEDATA_PAID: paid, WATCHLIST: watch(EIGHT_STOCKS) }, { TWELVEDATA_KEY: 'key' });

    await run(phone, NOON);
    save(phone, { WATCHLIST: watch(`NEW, ${EIGHT_STOCKS}`) });

    await run(phone, NOON + 30 * 1000);
    const result = callsTo(phone, 'api.twelvedata.com').length;

    expect(result).toBe(calls);
  });

  /** One ticker a run is only there to stretch a free key's 25 a day, and a paid key would wait for nothing. */
  test('fetches every Alpha Vantage ticker in one run with Paid Plan on', async () => {
    const phone = fakePhone({ PROVIDER: 'alphavantage', ALPHAVANTAGE_PAID: true, WATCHLIST: watch(EIGHT_STOCKS) }, { ALPHAVANTAGE_KEY: 'paid-key' });

    await run(phone, NOON);
    const result = callsTo(phone, 'www.alphavantage.co').length;

    expect(result).toBe(8);
  });

  /** Two calls close together can still be refused on a paid key, and asking for every ticker again would only be refused again. */
  test('asks Alpha Vantage again only for the tickers its burst limit refused', async () => {
    const phone = fakePhone({ PROVIDER: 'alphavantage', ALPHAVANTAGE_PAID: true, WATCHLIST: watch('IBM, MSFT, NVDA') }, { ALPHAVANTAGE_KEY: 'paid-key' });

    phone.replies['www.alphavantage.co MSFT'] = AV_BURST;
    await run(phone, NOON);
    delete phone.replies['www.alphavantage.co MSFT'];

    const answer = await run(phone, NOON + 10 * 1000);

    expect([phone.calls.map((call) => call.symbol), shown(answer)]).toEqual([['IBM', 'MSFT', 'MSFT', 'NVDA'], ['IBM 100.00 Alpha Vantage', 'MSFT 100.00 Alpha Vantage', 'NVDA 100.00 Alpha Vantage']]);
  });

  /** A paid plan still has its own limits, and a provider that says stop has to be left alone as it would be on a free key. */
  test.each([
    ['twelvedata', 'TWELVEDATA', 'api.twelvedata.com', TD_MINUTE, MINUTE_MS + 1000],
    ['finnhub', 'FINNHUB', 'finnhub.io', { error: 'http 429' }, 15 * MINUTE_MS],
  ] as const)('still waits after %s answers RATE LIMIT with Paid Plan on', async (provider, prefix, host, reply, wait) => {
    const phone = fakePhone({ PROVIDER: provider, [`${prefix}_PAID`]: true, WATCHLIST: watch('AAPL') }, { [`${prefix}_KEY`]: 'paid-key' });

    phone.replies[host] = reply;

    await run(phone, NOON);
    const result = recordOf(phone, provider).retryAtMs;

    expect(result).toBe(NOON + wait);
  });

  /** Prices held back by the free plan's floors should not linger once the wearer says the key is paid. */
  test('fetches again once Paid Plan is turned on', async () => {
    const phone = fakePhone({ PROVIDER: 'twelvedata', WATCHLIST: watch('AAPL') }, { TWELVEDATA_KEY: 'key' });

    await run(phone, NOON);
    save(phone, { TWELVEDATA_PAID: true });

    await run(phone, NOON + MINUTE_MS);
    const result = callsTo(phone, 'api.twelvedata.com').length;

    expect(result).toBe(2);
  });
});
