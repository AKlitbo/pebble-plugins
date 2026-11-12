/**
 * Weather Enhanced's settings page. The framework builds it into the pbw's config.html, loads the
 * saved settings from the plugin when it opens, and hands them back on Save.
 *
 * It runs top to bottom in the order a wearer sets it up: the Data Source with the picked provider's
 * key and Paid Plan, the places, the refresh, and the units. The line about the watch's own Weather app
 * sits above Save, and the credits each picked provider asks for sit under it.
 */

import type { ClayConfigItem } from '../../paf/ts/clay/types';
import { APP_UNIT, APP_UNIT_LABEL, DEFAULTS, OPEN_METEO, PLACES_CHOICES, PROVIDERS, REFRESH_MINUTES, UNIT_CHOICES, UNIT_ROWS, UNITS_MESSAGE } from '../settings';
import weatherPage from './weather-page';
import type { UnitsOptions } from './weather-page';

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

/**
 * A select for one unit, opening on the Pebble app's own. The page code puts the Pebble app's unit after
 * Pebble App once the plugin says what it is.
 */
function unitRow(messageKey: keyof typeof UNIT_CHOICES, label: string): ClayConfigItem {
  return { type: 'select', messageKey, label, defaultValue: DEFAULTS[messageKey], options: [{ label: APP_UNIT_LABEL, value: APP_UNIT }, ...UNIT_CHOICES[messageKey]] };
}

/** What the page code needs to ask the plugin for the Pebble app's units and show them. */
const UNITS_OPTIONS: UnitsOptions = { unitsMessage: UNITS_MESSAGE, rows: UNIT_ROWS, appValue: APP_UNIT, appLabel: APP_UNIT_LABEL };

/** A credit line under Save, centred by the framework's `pf-footer` class. */
function creditRow(credit: string, visibleWhen?: ClayConfigItem['visibleWhen']): ClayConfigItem {
  const row: ClayConfigItem = { type: 'text', defaultValue: `<div class="pf-footer">${credit}</div>` };

  return visibleWhen ? { ...row, visibleWhen } : row;
}

export const clayConfig: ClayConfigItem[] = [
  { type: 'heading', defaultValue: 'Weather Enhanced' },
  { type: 'text', defaultValue: "Serves the weather for the places in the Pebble app's weather list to every watchface that reads weather plugins." },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Weather' },
      {
        type: 'select',
        messageKey: 'PROVIDER',
        label: 'Data Source',
        defaultValue: DEFAULTS.PROVIDER,
        options: PROVIDERS.map((provider) => ({ label: provider.label, value: provider.id })),
      },
      ...providerRows(),
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Places' },
      { type: 'select', messageKey: 'PLACES', label: 'Places to Fetch', defaultValue: DEFAULTS.PLACES, options: PLACES_CHOICES },
      { type: 'text', defaultValue: "The places come from the Pebble app's weather list, in its order." },
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
        options: REFRESH_MINUTES.map((minutes) => ({ label: minutes === '60' ? '1 Hour' : minutes === '120' ? '2 Hours' : `${minutes} Minutes`, value: minutes })),
      },
      { type: 'text', defaultValue: "How old a place's weather can get before it is fetched again. The Pebble app decides exactly when the plugin runs." },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Units' },
      { type: 'text', id: 'we-units', defaultValue: 'Each unit follows the Pebble app until you pick another here.', moduleOptions: UNITS_OPTIONS },
      unitRow('TEMPERATURE_UNIT', 'Temperature'),
      unitRow('WIND_UNIT', 'Wind Speed'),
      unitRow('PRESSURE_UNIT', 'Pressure'),
    ],
  },
  { type: 'text', defaultValue: "Pick Weather Enhanced for Weather under Preferred Sources in the Pebble app's plugin settings, and it also feeds the watch's own Weather app and the timeline's weather pins." },
  { type: 'submit', defaultValue: 'Save' },
  creditRow(OPEN_METEO.credit),
  ...PROVIDERS.filter((provider) => provider !== OPEN_METEO).map((provider) => creditRow(provider.credit, { key: 'PROVIDER', in: [provider.id] })),
];

export const customClay = weatherPage;
