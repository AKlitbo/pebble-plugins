/**
 * Stocks + Crypto's settings page. The framework builds it into the pbw's config.html, loads the
 * saved settings from the plugin when it opens, and hands them back on Save.
 *
 * It follows the plainer look of Pebble's own Stocks page: a heading and one line, then the controls,
 * the Data Source first and the watchlist after it.
 * The watchlist is drawn by the page code in watchlist-page.ts into its container row, and kept in a
 * hidden row the framework saves with the rest.
 */

import { CALLOUT_BADGE, CALLOUT_BOX } from '../../paf/ts/clay/callout-style';
import type { ClayConfigItem } from '../../paf/ts/clay/types';
import { ALPHAVANTAGE_TICKERS, MOST_TICKERS } from '../limits';
import { DEFAULTS, PROVIDERS, REFRESH_MINUTES } from '../settings';
import { ADD_MESSAGE, DEFAULT_WATCHLIST, NAMES_MESSAGE } from '../watchlist';
import watchlistPage from './watchlist-page';
import type { WatchlistOptions } from './watchlist-page';

/** Each provider's description, and its key and Paid Plan rows for the providers that need a key, shown only while it is picked. */
function providerRows(): ClayConfigItem[] {
  return PROVIDERS.flatMap((provider) => {
    const shown = { key: 'PROVIDER', in: [provider.id] };
    const rows: ClayConfigItem[] = [{ type: 'text', defaultValue: provider.description, visibleWhen: shown }];

    if (provider.keySetting) {
      rows.push({ type: 'input', messageKey: provider.keySetting, label: `${provider.label} API Key`, defaultValue: DEFAULTS[provider.keySetting], attributes: { autocomplete: 'off', autocapitalize: 'off' }, visibleWhen: shown });
    }

    if (provider.paidSetting) {
      rows.push({ type: 'toggle', messageKey: provider.paidSetting, label: 'Paid Plan', defaultValue: DEFAULTS[provider.paidSetting], visibleWhen: shown });
    }

    return rows;
  });
}

/** The providers that take a key, whose rows only show while one of them is picked. */
const KEYED = PROVIDERS.filter((provider) => provider.keySetting).map((provider) => provider.id);

const WATCHLIST_OPTIONS: WatchlistOptions = {
  defaultList: DEFAULT_WATCHLIST,
  alphaVantageCap: ALPHAVANTAGE_TICKERS,
  addMessage: ADD_MESSAGE,
  namesMessage: NAMES_MESSAGE,
  perKind: MOST_TICKERS,
  calloutBox: CALLOUT_BOX,
  calloutBadge: CALLOUT_BADGE,
};

export const clayConfig: ClayConfigItem[] = [
  { type: 'heading', defaultValue: 'Stocks + Crypto' },
  { type: 'text', defaultValue: 'Each ticker you add shows up on the watch as its own instance.' },
  { type: 'text', defaultValue: "For a watchface to show these, pick Stocks + Crypto under Preferred Sources in the Pebble app's plugin settings." },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Stocks' },
      {
        type: 'select',
        messageKey: 'PROVIDER',
        label: 'Data Source',
        defaultValue: DEFAULTS.PROVIDER,
        options: PROVIDERS.map((provider) => ({ label: provider.label, value: provider.id })),
      },
      ...providerRows(),
      {
        type: 'text',
        defaultValue: 'If the provider turns your key away for every ticker, the plugin leaves it alone until you save, or for a day.',
        visibleWhen: { key: 'PROVIDER', in: KEYED },
      },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Watchlist' },
      { type: 'text', id: 'sc-watchlist', defaultValue: '', moduleOptions: WATCHLIST_OPTIONS },
      { type: 'input', messageKey: 'WATCHLIST', label: 'Watchlist', defaultValue: DEFAULTS.WATCHLIST },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Refresh' },
      {
        type: 'select',
        messageKey: 'REFRESH',
        label: 'Refresh Interval',
        defaultValue: DEFAULTS.REFRESH,
        options: REFRESH_MINUTES.map((minutes) => ({ label: minutes === '60' ? '1 Hour' : `${minutes} Minutes`, value: minutes })),
      },
      { type: 'text', defaultValue: 'How old the prices can get before they are fetched again. The Pebble app decides exactly when the plugin runs.' },
      // each note shows only for the provider and plan it is true of, so the card says what holds for the wearer's own key
      {
        type: 'text',
        defaultValue: "Twelve Data's free key fetches at most every 15 minutes while New York's market is open, and every 3 hours while it is shut.",
        visibleWhen: [{ key: 'PROVIDER', in: ['twelvedata'] }, { key: 'TWELVEDATA_PAID', notIn: [true] }],
      },
      {
        type: 'text',
        defaultValue: "Alpha Vantage's free key has end of day prices only, fetched in the evening once the close is out, so the interval mostly matters for crypto.",
        visibleWhen: [{ key: 'PROVIDER', in: ['alphavantage'] }, { key: 'ALPHAVANTAGE_PAID', notIn: [true] }],
      },
      {
        type: 'text',
        defaultValue: 'Paid Plan is on, so your key fetches at every interval.',
        visibleWhen: [{ key: 'PROVIDER', in: ['twelvedata'] }, { key: 'TWELVEDATA_PAID', in: [true] }],
      },
      {
        type: 'text',
        defaultValue: 'Paid Plan is on, so your key fetches at every interval.',
        visibleWhen: [{ key: 'PROVIDER', in: ['alphavantage'] }, { key: 'ALPHAVANTAGE_PAID', in: [true] }],
      },
    ],
  },
  { type: 'submit', defaultValue: 'Save' },
  // the page code centres it under the Save button
  { type: 'text', defaultValue: '<div class="sc-footer">Prices can be delayed. For information only, not financial advice.</div>' },
];

export const customClay = watchlistPage;
