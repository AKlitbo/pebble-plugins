/**
 * Weather Enhanced's settings page. The framework builds it into the pbw's config.html, loads the
 * saved settings from the plugin when it opens, and hands them back on Save.
 *
 * It runs top to bottom in the order a wearer sets it up: the Data Source with the picked provider's
 * key and Paid Plan, the places, adding a place, the refresh, and the units. The place list is drawn by
 * the page code in places-page.ts into its text row, and kept in a hidden row the framework saves with
 * the rest. A second hidden row, `PLACES`, holds the Places to Fetch a Weather Enhanced 1.0.0 save
 * carries, so a save keeps it until the list holds the Pebble app's places. Adding a place uses the
 * framework's location search, which the page passes as a component, and its rows have no message key,
 * so only the place list saves what they add. The line about the
 * watch's own Weather app sits above Save, and the credits each picked provider asks for sit under it.
 */

import { combineCustomFns } from '../../paf/ts/clay/custom-fn';
import locationSearch from '../../paf/ts/clay/location-component';
import type { ClayConfigItem } from '../../paf/ts/clay/types';
import { ADDED_PREFIX, ADD_PLACE_MESSAGE, APP_UNIT, APP_UNIT_LABEL, DEFAULTS, MOST_ADDED, MOST_PLACES, NAME_MAX, OPEN_METEO, PLACES_MESSAGE, PROVIDERS, REFRESH_MINUTES, UNIT_CHOICES, UNIT_ROWS, UNITS_MESSAGE } from '../settings';
import placesPage from './places-page';
import type { PlacesOptions } from './places-page';
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

/** What the page code needs to ask the plugin for the place list and save it. */
const PLACES_OPTIONS: PlacesOptions = {
  placesMessage: PLACES_MESSAGE,
  listKey: 'PLACE_LIST',
  useAppKey: 'USE_APP_PLACES',
  oldPlacesKey: 'PLACES',
  most: MOST_PLACES,
  mostAdded: MOST_ADDED,
  addedPrefix: ADDED_PREFIX,
  nameMax: NAME_MAX,
  addMessage: ADD_PLACE_MESSAGE,
  searchId: 'we-add-search',
  nameId: 'we-add-name',
  addId: 'we-add',
  addNoteId: 'we-add-note',
};

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
      { type: 'toggle', messageKey: 'USE_APP_PLACES', label: 'Pebble App Places', defaultValue: DEFAULTS.USE_APP_PLACES },
      { type: 'text', defaultValue: "The Pebble app's places are added, renamed, and removed in its weather list.", visibleWhen: { key: 'USE_APP_PLACES', in: [true] } },
      { type: 'text', defaultValue: `Watchfaces get the places switched on here, top first, up to ${MOST_PLACES}. Move a place with its arrows.`, moduleOptions: PLACES_OPTIONS },
      { type: 'input', messageKey: 'PLACE_LIST', label: 'Place List', defaultValue: DEFAULTS.PLACE_LIST, attributes: { type: 'hidden' } },
      { type: 'input', messageKey: 'PLACES', label: 'Places to Fetch', defaultValue: DEFAULTS.PLACES, attributes: { type: 'hidden' } },
      { type: 'text', defaultValue: "The watch's own Weather app and the timeline's weather pins keep the Pebble app's list and order, so a place switched off here still shows there, with weather from Pebble. Places added here show only on watchfaces." },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Add a Place' },
      { type: 'locationsearch', id: 'we-add-search', label: 'Search', attributes: { placeholder: 'A town or city' } },
      { type: 'input', id: 'we-add-name', label: 'Name', defaultValue: '', attributes: { autocapitalize: 'words', autocomplete: 'off' } },
      { type: 'button', id: 'we-add', defaultValue: 'Add' },
      { type: 'text', id: 'we-add-note', defaultValue: `Search for a place, pick it, and change its name if you like. Up to ${MOST_ADDED} places can be added.` },
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

/** The framework's location search, which Add a Place searches with. */
export const components = [locationSearch];

export const customClay = combineCustomFns([
  { code: weatherPage, label: 'the unit rows' },
  { code: placesPage, label: 'the place list' },
]);
