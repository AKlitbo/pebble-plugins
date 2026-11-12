/**
 * The plans Weather Enhanced holds each provider to, from each one's free plan.
 *
 * The framework's ledger counts the calls against these. Where a provider does not say whether a limit
 * follows the clock, the limit rolls, since a rolling window never lets more through than a clock
 * window of the same length. WeatherAPI.com says its month resets on the 1st, UTC, so that one follows
 * the clock. Open-Meteo is keyless, so the phone keeps one ledger for it whatever the key fields hold.
 * A wearer whose key is on a paid plan turns Paid Plan on, and the plugin then leaves the counting to
 * the provider's own rate limit answers.
 */

import type { QuotaPlan } from '../paf/ts/quota/ledger';
import type { ProviderId } from './settings';

/** Where the ledger is kept in `localStorage`. */
export const LEDGER_KEY = 'weather-enhanced-ledger';

/** Each provider's free plan, as the ledger reads it. */
export const QUOTA_PLANS: Record<ProviderId, QuotaPlan> = {
  openmeteo: {
    keyed: false,
    limits: [
      { calls: 600, window: 'minute', follows: 'rolling' },
      { calls: 5000, window: 'hour', follows: 'rolling' },
      { calls: 10000, window: 'day', follows: 'rolling' },
      { calls: 300000, window: 'month', follows: 'rolling' },
    ],
  },
  owm: {
    keyed: true,
    limits: [
      { calls: 60, window: 'minute', follows: 'rolling' },
      { calls: 1000000, window: 'month', follows: 'rolling' },
    ],
  },
  weatherapi: {
    keyed: true,
    limits: [{ calls: 100000, window: 'month', follows: 'clock' }],
  },
};
