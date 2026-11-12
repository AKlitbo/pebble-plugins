/**
 * Stocks + Crypto's settings, shared by its settings page and its plugin script, so the keys, their
 * defaults, which ones are secret, and the four providers are written once.
 *
 * Each provider keeps a key of its own, and its own Paid Plan switch, so switching provider and back
 * loses nothing. The keys are secret, so the plugin keeps them in the phone's encrypted storage. The
 * refresh is how many minutes a copy of the prices is served before the next fetch.
 *
 * Each keyed provider's description quotes its free plan from the framework's `FREE_PLANS`, so a
 * provider that changes its plan is corrected there alone.
 */

import type { SettingsOptions } from '../paf/ts/plugin-app/settings';
import { FREE_PLANS } from '../paf/ts/stock/limits';
import { ALPHAVANTAGE_TICKERS, limitsFor } from './limits';
import type { ProviderId } from './limits';

export type { ProviderId } from './limits';

const TWELVEDATA = FREE_PLANS.twelvedata;
const ALPHAVANTAGE = FREE_PLANS.alphavantage;

/** What the plugin knows about one provider. */
export interface Provider {
  id: ProviderId;
  /** Its name on the settings page and in each quote's `source`. */
  label: string;
  /** The one site it fetches from, as the appinfo's Internet permission names it. */
  domain: string;
  /** The setting its API key is saved under, or none for a provider that needs no key. */
  keySetting?: 'FINNHUB_KEY' | 'TWELVEDATA_KEY' | 'ALPHAVANTAGE_KEY';
  /** The setting that says its key is on a paid plan, for a provider that needs a key. */
  paidSetting?: 'FINNHUB_PAID' | 'TWELVEDATA_PAID' | 'ALPHAVANTAGE_PAID';
  /** What the settings page says about it while it is picked. */
  description: string;
}

/** The four providers, in the order the Data Source select offers them. */
export const PROVIDERS: Provider[] = [
  {
    id: 'yahoo',
    label: 'Yahoo',
    domain: 'query1.finance.yahoo.com',
    description: 'Yahoo needs no key and covers the most markets, but it is an unofficial feed that can break without warning.',
  },
  {
    id: 'finnhub',
    label: 'Finnhub',
    domain: 'finnhub.io',
    keySetting: 'FINNHUB_KEY',
    paidSetting: 'FINNHUB_PAID',
    description: "Finnhub is real-time for US stocks on a free key, which can't price most indexes or markets outside the US.",
  },
  {
    id: 'twelvedata',
    label: 'Twelve Data',
    domain: 'api.twelvedata.com',
    keySetting: 'TWELVEDATA_KEY',
    paidSetting: 'TWELVEDATA_PAID',
    description:
      `Twelve Data covers US markets on a free key that allows ${TWELVEDATA.perMinute} quotes a minute and ${TWELVEDATA.perDay} a day, and 20+ markets on a paid plan. ` +
      `A free key prices up to ${limitsFor('twelvedata', false).tickerCap} stocks, every 15 minutes while New York is open and every 3 hours while it is shut. ` +
      'Turn on Paid Plan if your key is on one.',
  },
  {
    id: 'alphavantage',
    label: 'Alpha Vantage',
    domain: 'www.alphavantage.co',
    keySetting: 'ALPHAVANTAGE_KEY',
    paidSetting: 'ALPHAVANTAGE_PAID',
    description:
      `Alpha Vantage only fetches the day's close. A free key allows ${ALPHAVANTAGE.perDay} quotes a day, so it prices your first ${ALPHAVANTAGE_TICKERS} stocks, one at a time. ` +
      'A watchface on the same key counts its own calls, so the two together can run the day out. ' +
      'Turn on Paid Plan if your key is on one.',
  },
];

/** Yahoo, which serves the crypto tickers whatever the stock provider is. */
export const YAHOO = PROVIDERS[0];

/** Every setting's key and the value it opens on. */
export const DEFAULTS = {
  PROVIDER: 'yahoo',
  FINNHUB_KEY: '',
  FINNHUB_PAID: false,
  TWELVEDATA_KEY: '',
  TWELVEDATA_PAID: false,
  ALPHAVANTAGE_KEY: '',
  ALPHAVANTAGE_PAID: false,
  // empty until a save, so a list saved as the two comma lists before the watchlist reads in its place
  WATCHLIST: '',
  REFRESH: '5',
};

/** What the framework's settings helpers are told about these settings. */
export const SETTINGS_OPTIONS: SettingsOptions = {
  secret: ['FINNHUB_KEY', 'TWELVEDATA_KEY', 'ALPHAVANTAGE_KEY'],
  defaults: DEFAULTS,
  refresh: ['finance/stock', 'finance/crypto'],
};

/** The Refresh Interval choices, in minutes, as the page offers them. */
export const REFRESH_MINUTES = ['5', '10', '15', '30', '60'];

/**
 * The provider the settings pick, falling back to Yahoo for a value the page never offered.
 *
 * @param saved The saved Data Source.
 * @return The provider.
 */
export function providerOf(saved: unknown): Provider {
  return PROVIDERS.find((provider) => provider.id === saved) || YAHOO;
}
