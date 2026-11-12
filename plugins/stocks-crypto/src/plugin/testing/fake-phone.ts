/**
 * A stand-in for the phone a run of Stocks + Crypto sees: its `localStorage`, its encrypted storage,
 * the Pebble app's runtime, and the four providers' sites.
 *
 * Each provider answers a good quote for any ticker unless a spec tells it otherwise, and every call
 * is recorded with the time of the run that made it, so a spec can count the calls a day spends.
 */

import type { PluginPebble, SourceResponder } from '../../../paf/ts/plugin-app/runtime';
import { SETTINGS_KEY } from '../../../paf/ts/plugin-app/settings';
import type { SourceInstance } from '../../../paf/ts/plugin-sources/types';
import type { RequestFn } from '../../../paf/ts/stock/util';
import { handleSource } from '../serve';

/** One call a provider got. */
export interface Call {
  host: string;
  symbol: string;
  atMs: number;
}

/** How a provider answers one ticker: a good quote, or an error and body of its own. */
export type Reply = 'ok' | { error: string | null; body?: string };

/** What a run answered, its data or the error code. */
export type Answered = { validUntilMs?: number; instances: SourceInstance[] } | string;

/** A phone with these saved settings and secrets, kept across runs. */
export function fakePhone(saved: Record<string, unknown>, secrets: Record<string, string> = {}) {
  const items = new Map<string, string>([[SETTINGS_KEY, JSON.stringify(saved)]]);
  const phone = {
    items,
    storage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) },
    secrets,
    calls: [] as Call[],
    /** The time of the run going now, which each call is stamped with. */
    nowMs: 0,
    /** How each provider host answers a ticker, by `host` or `host symbol`. Anything unlisted is a good quote. */
    replies: {} as Record<string, Reply>,
    /** How many times the run read or subscribed to another plugin's source. */
    otherPlugins: 0,
    /** What `Pebble.permissions.query` answers for a key, `granted` when unlisted. */
    permissions: {} as Record<string, string>,
    /** Runs at each call, before it is answered, so a spec can look at what was kept by then. */
    onCall: (() => undefined) as () => void,
  };

  return phone;
}

export type FakePhone = ReturnType<typeof fakePhone>;

/** A good quote body for a ticker, in the provider's own shape, priced 100 and up 1 from 99. */
function goodBody(host: string, symbol: string, phone: FakePhone): string {
  const epoch = Math.floor(phone.nowMs / 1000);

  if (host === 'query1.finance.yahoo.com') {
    return JSON.stringify({ chart: { result: [{ meta: { symbol, regularMarketPrice: 100, chartPreviousClose: 99, regularMarketTime: epoch, currency: 'USD' } }] } });
  }

  if (host === 'finnhub.io') {
    return JSON.stringify({ c: 100, pc: 99, d: 1, dp: 1.01, t: epoch });
  }

  if (host === 'api.twelvedata.com') {
    return JSON.stringify({ symbol, close: '100', change: '1', percent_change: '1.01', datetime: '2026-11-04', currency: 'USD' });
  }

  // Alpha Vantage, still holding the day before's close
  return JSON.stringify({ 'Global Quote': { '05. price': '100', '09. change': '1', '10. change percent': '1.01%', '07. latest trading day': '2026-11-03' } });
}

/** The ticker a provider URL asks for. */
function symbolOf(url: URL): string {
  const asked = url.searchParams.get('symbol');

  return decodeURIComponent(asked || url.pathname.split('/').pop() || '');
}

/** The providers' sites, answering from the phone's replies and recording every call. */
export function providerSites(phone: FakePhone): RequestFn {
  return (address, callback) => {
    const url = new URL(address);
    const symbol = symbolOf(url);

    phone.calls.push({ host: url.hostname, symbol, atMs: phone.nowMs });
    phone.onCall();

    const reply = phone.replies[`${url.hostname} ${symbol}`] || phone.replies[url.hostname] || 'ok';

    if (reply === 'ok') {
      callback(null, goodBody(url.hostname, symbol, phone));
    } else {
      callback(reply.error, reply.body);
    }
  };
}

/**
 * Runs the source handler once at a moment and gives back its answer.
 *
 * @param phone The phone.
 * @param nowMs The moment.
 * @param onAnswer Runs as the answer goes out, before the run ends.
 * @param item The item the Pebble app asks for, `stock` unless a spec says otherwise.
 * @return The answer.
 */
export async function run(phone: FakePhone, nowMs: number, onAnswer: () => void = () => undefined, item = 'stock'): Promise<Answered> {
  let handler: ((request: unknown, respond: SourceResponder) => void | Promise<void>) | null = null;
  const answers: Answered[] = [];
  const pebble = {
    registerSourceHandler: (registered: typeof handler) => void (handler = registered),
    subscribeSource: () => void phone.otherPlugins++,
    readSource: async () => {
      phone.otherPlugins++;
      throw Object.assign(new Error('PLUGIN_UNAVAILABLE'), { code: 'PLUGIN_UNAVAILABLE' });
    },
    secureStorage: { getItem: async (key: string) => phone.secrets[key] ?? null },
    permissions: { query: async (key: string) => phone.permissions[key] ?? 'granted' },
  } as unknown as PluginPebble;

  phone.nowMs = nowMs;
  handleSource({ pebble, storage: phone.storage, request: providerSites(phone) }, () => nowMs);
  await handler!(
    { category: 'finance', item },
    {
      data: (envelope) => (onAnswer(), void answers.push(envelope)),
      error: (code) => (onAnswer(), void answers.push(code)),
    }
  );

  return answers[0];
}

/** What a face would show for each served ticker: its id, its price or status, and its source. */
export function shown(answer: Answered): string[] {
  if (typeof answer === 'string') {
    return [answer];
  }

  return answer.instances.map((instance) => {
    const properties = instance.properties || {};
    const value = properties.price?.shortText?.text ?? properties.status?.shortText?.text;

    return `${instance.instanceId} ${value} ${properties.source?.shortText?.text}`;
  });
}
