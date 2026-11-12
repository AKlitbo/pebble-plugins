/**
 * The stops Weather Enhanced keeps per provider, on top of the framework's ledger, after the provider
 * itself turned a fetch away.
 *
 * * **RATE LIMIT** means the provider counted more than the ledger did, such as a watchface fetching on
 *   the same key. When the answer names the limit it hit, such as WeatherAPI.com's spent month, it
 *   holds the provider until that limit opens again, the 1st of the month for that one. A bare rate
 *   limit holds until the provider's shortest limit opens, a minute for Open-Meteo and OpenWeatherMap,
 *   and no longer than an hour, so WeatherAPI.com, whose only limit is the month, is asked again in an
 *   hour. A key on a paid plan is held to none of those limits, so it waits a minute. Turning Paid Plan
 *   on or off on a save lifts the stop, since the limits it was held to have changed.
 * * **INVALID KEY** holds the provider until the wearer saves the settings, or a day goes by, since a
 *   key can be fixed on the provider's side.
 *
 * Each stop carries the fingerprint of the key it belongs to, so a different key starts afresh.
 */

import { windowOpensAt } from '../../paf/ts/quota/ledger';
import type { QuotaLimit, QuotaPlan, QuotaWindow } from '../../paf/ts/quota/ledger';
import { QUOTA_PLANS } from '../limits';
import type { ProviderId } from '../settings';

/** Where the stops are kept in `localStorage`. */
export const STOPS_KEY = 'weather-enhanced-stops';

/** How long a stop after a bad key holds with no save. */
export const STOP_HOLDS_MS = 24 * 60 * 60 * 1000;

/** How long a rate limit holds a key on a paid plan, whose limits the plugin does not know. */
export const PAID_HOLDS_MS = 60 * 1000;

/** The longest a rate limit that names no limit holds a provider. */
export const BARE_HOLDS_MS = 60 * 60 * 1000;

/** The part of `localStorage` the stops use, which a spec stands in for. */
export type StopStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The two answers that stop a provider. */
export type StopStatus = 'RATE LIMIT' | 'INVALID KEY';

/** One provider's stop, as kept between runs. */
export interface Stop {
  status: StopStatus;
  /** The fingerprint of the key it belongs to, empty for Open-Meteo. */
  print: string;
  /** When it was set. */
  atMs: number;
  /** When it lifts on its own. */
  untilMs: number;
}

const WINDOW_ORDER: Array<QuotaLimit['window']> = ['minute', 'hour', 'day', 'month'];

/** Every stop kept, by provider. */
function readStops(storage: StopStorage): Partial<Record<ProviderId, Stop>> {
  try {
    const saved = JSON.parse(storage.getItem(STOPS_KEY) || 'null');

    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

/** Keeps every stop. */
function writeStops(storage: StopStorage, stops: Partial<Record<ProviderId, Stop>>): void {
  try {
    storage.setItem(STOPS_KEY, JSON.stringify(stops));
  } catch (error) {
    console.log(`Weather Enhanced: a stop could not be kept, ${error}`);
  }
}

/**
 * When a provider that answered RATE LIMIT is asked again.
 *
 * The answer means a count is full. One that names its limit, and is a limit of the plan, waits for
 * that limit to open again. One that names none waits for the shortest limit, and no longer than
 * `BARE_HOLDS_MS`, since a bare answer may only have been a burst. A rolling limit opens a window
 * later, and one on the clock at its next start.
 */
function rateLimitLifts(plan: QuotaPlan, limit: QuotaWindow | undefined, nowMs: number): number {
  const named = plan.limits.find((each) => each.window === limit);

  if (named) {
    return windowOpensAt(named, nowMs);
  }

  const shortest = plan.limits.slice().sort((one, other) => WINDOW_ORDER.indexOf(one.window) - WINDOW_ORDER.indexOf(other.window))[0];

  return shortest ? Math.min(windowOpensAt(shortest, nowMs), nowMs + BARE_HOLDS_MS) : nowMs;
}

/**
 * The stop holding a provider now, if one does.
 *
 * A clock set back before the stop lifts it, rather than holding the provider for however long the
 * clock moved.
 *
 * @param storage Where the stops are kept, normally `localStorage`.
 * @param provider The provider.
 * @param print The fingerprint of the key the run fetches with, empty for none.
 * @param nowMs The time now.
 * @return The stop's status, or null when the provider can fetch.
 */
export function stoppedBy(storage: StopStorage, provider: ProviderId, print: string, nowMs: number): StopStatus | null {
  const stop = readStops(storage)[provider];
  const holds = stop && stop.print === print && typeof stop.atMs === 'number' && typeof stop.untilMs === 'number' && stop.atMs <= nowMs && nowMs < stop.untilMs;

  return holds ? (stop as Stop).status : null;
}

/**
 * Stops a provider after it turned a fetch away.
 *
 * @param storage Where the stops are kept, normally `localStorage`.
 * @param provider The provider.
 * @param print The fingerprint of the key it turned away, empty for none.
 * @param status What it answered.
 * @param nowMs The time now.
 * @param paid Whether the key is on a paid plan, which holds a rate limit for a minute rather than the free plan's window.
 * @param limit The limit a rate limit answer named, such as `month`, or undefined for none.
 */
export function setStop(storage: StopStorage, provider: ProviderId, print: string, status: StopStatus, nowMs: number, paid = false, limit?: QuotaWindow): void {
  const stops = readStops(storage);
  const rateLimitMs = paid ? nowMs + PAID_HOLDS_MS : rateLimitLifts(QUOTA_PLANS[provider], limit, nowMs);
  const untilMs = status === 'INVALID KEY' ? nowMs + STOP_HOLDS_MS : rateLimitMs;

  stops[provider] = { status, print, atMs: nowMs, untilMs };
  writeStops(storage, stops);
}

/**
 * Lifts every stop after a bad key, for a save from the settings page, since a save is where the
 * wearer fixes a key. A rate limit stays, since the provider would only answer it again.
 *
 * @param storage Where the stops are kept, normally `localStorage`.
 */
export function liftKeyStops(storage: StopStorage): void {
  const stops = readStops(storage);
  const kept: Partial<Record<ProviderId, Stop>> = {};

  (Object.keys(stops) as ProviderId[]).forEach((provider) => {
    const stop = stops[provider];

    if (stop && stop.status !== 'INVALID KEY') {
      kept[provider] = stop;
    }
  });

  writeStops(storage, kept);
}

/**
 * Lifts the rate limit stops of the providers whose Paid Plan switch a save changed, since the limits
 * the stop held them to have changed with it.
 *
 * @param storage Where the stops are kept, normally `localStorage`.
 * @param providers The providers whose Paid Plan changed.
 */
export function liftRateLimits(storage: StopStorage, providers: ProviderId[]): void {
  const stops = readStops(storage);

  providers.forEach((provider) => {
    const stop = stops[provider];

    if (stop && stop.status === 'RATE LIMIT') {
      delete stops[provider];
    }
  });

  writeStops(storage, stops);
}
