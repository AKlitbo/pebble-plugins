/**
 * The limits Stocks + Crypto holds each provider to, worked out from the framework's free plans.
 *
 * The framework's `FREE_PLANS` holds what each provider's free plan allows, and its ledger counts the
 * calls against them. What sits here is only the plugin's own choices on top: how many tickers each
 * provider prices, and Alpha Vantage's one ticker a run. A wearer whose key is on a paid plan turns
 * Paid Plan on, and the plugin then leaves the limits to the provider's own rate limit answers.
 */

import { FREE_PLANS, onPaidPlan } from '../paf/ts/stock/limits';

/** The providers' ids, as the Data Source select saves them and the framework's providers name them. */
export type ProviderId = 'yahoo' | 'finnhub' | 'twelvedata' | 'alphavantage';

/** The most tickers each list on the page takes. */
export const MOST_TICKERS = 8;

/**
 * How many tickers Alpha Vantage's free key prices.
 *
 * The framework's schedule lets a ticker through once at any hour when it has no quote, and three
 * times after the close until the day's close is in. So each ticker can cost 4 calls a day, and 4
 * tickers is 16, under the 20 the ledger lets a routine day spend.
 */
export const ALPHAVANTAGE_TICKERS = 4;

/** How one provider is held. */
export interface ProviderLimits {
  /** The most stock tickers it prices. Any past it get no price from it. */
  tickerCap: number;
  /** Whether each ticker keeps its own quota stamps and only one is fetched a run. */
  oneAtATime: boolean;
  /** Whether the wearer's key is on a paid plan, which leaves the free plan's floors and counts out. */
  paid: boolean;
}

/**
 * The limits a provider keeps to.
 *
 * On a free key, a provider prices as many tickers as one round can send without passing its calls a
 * second or a minute, so Twelve Data's 8 a minute prices 8. Alpha Vantage prices
 * `ALPHAVANTAGE_TICKERS`, one a run, since the plugin has no timers to space calls a second apart.
 *
 * @param provider The provider.
 * @param paidPlan What the provider's Paid Plan switch saved.
 * @return Its limits.
 */
export function limitsFor(provider: ProviderId, paidPlan: boolean): ProviderLimits {
  const plan = FREE_PLANS[provider];

  if (onPaidPlan(provider, paidPlan)) {
    return { tickerCap: MOST_TICKERS, oneAtATime: false, paid: true };
  }

  if (provider === 'alphavantage') {
    return { tickerCap: ALPHAVANTAGE_TICKERS, oneAtATime: true, paid: false };
  }

  const perRound = [plan.perSecond, plan.perMinute].filter((limit): limit is number => limit !== null);

  return { tickerCap: Math.min(MOST_TICKERS, ...perRound), oneAtATime: false, paid: false };
}
