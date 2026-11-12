/**
 * Weather Enhanced's settings, shared by its settings page and its plugin script, so the keys, their
 * defaults, which ones are secret, and the three providers are written once.
 *
 * Each keyed provider keeps a key of its own, and its own Paid Plan switch, so switching provider and
 * back loses nothing. The keys are secret, so the plugin keeps them in the phone's encrypted storage.
 * The refresh is how many minutes a place's copy is served before the next fetch. Each unit reads
 * `app` until the wearer overrides it, which follows the Pebble app's own setting.
 */

import type { SettingsOptions } from '../paf/ts/plugin-app/settings';

/** The providers' ids, as the Data Source select saves them and the framework's weather providers name them. */
export type ProviderId = 'openmeteo' | 'owm' | 'weatherapi';

/** What the plugin knows about one provider. */
export interface Provider {
  id: ProviderId;
  /** Its name on the settings page and in each reading's `source`. */
  label: string;
  /** The setting its API key is saved under, or none for a provider that needs no key. */
  keySetting?: 'OWM_KEY' | 'WEATHERAPI_KEY';
  /** The setting that says its key is on a paid plan, for a provider that needs a key. */
  paidSetting?: 'OWM_PAID' | 'WEATHERAPI_PAID';
  /** What the settings page says about it while it is picked. */
  description: string;
  /** The credit its terms ask for, in the footer under Save. */
  credit: string;
}

/** The three providers, in the order the Data Source select offers them. */
export const PROVIDERS: Provider[] = [
  {
    id: 'openmeteo',
    label: 'Open-Meteo',
    description: 'Open-Meteo needs no key.',
    // TODO: confirm Open-Meteo's exact credit wording from its licence page
    // the spaces in the licence name do not break, so it never splits across two lines
    credit: 'Weather data by Open-Meteo.com under CC\u00a0BY\u00a04.0.',
  },
  {
    id: 'owm',
    label: 'OpenWeatherMap',
    keySetting: 'OWM_KEY',
    paidSetting: 'OWM_PAID',
    description: "OpenWeatherMap's free key gives the weather now, and the forecast comes from Open-Meteo. A new key can take a couple of hours to start working. Turn on Paid Plan if your key is on one.",
    credit: 'Weather data © OpenWeather.',
  },
  {
    id: 'weatherapi',
    label: 'WeatherAPI.com',
    keySetting: 'WEATHERAPI_KEY',
    paidSetting: 'WEATHERAPI_PAID',
    description: "WeatherAPI.com's free key gives the weather now, and the forecast comes from Open-Meteo. Turn on Paid Plan if your key is on one.",
    credit: 'Powered by WeatherAPI.com.',
  },
];

/** Open-Meteo, which every provider's forecast comes from and which answers when the picked one cannot. */
export const OPEN_METEO = PROVIDERS[0];

/** The most places the plugin fetches, from the top of the Pebble app's weather list. */
export const MOST_PLACES = 5;

/** Every setting's key and the value it opens on. */
export const DEFAULTS = {
  PROVIDER: 'openmeteo',
  OWM_KEY: '',
  OWM_PAID: false,
  WEATHERAPI_KEY: '',
  WEATHERAPI_PAID: false,
  PLACES: 'all',
  REFRESH: '30',
  TEMPERATURE_UNIT: 'app',
  WIND_UNIT: 'app',
  PRESSURE_UNIT: 'app',
};

/** What the framework's settings helpers are told about these settings. */
export const SETTINGS_OPTIONS: SettingsOptions = {
  secret: ['OWM_KEY', 'WEATHERAPI_KEY'],
  defaults: DEFAULTS,
  refresh: ['weather/location'],
};

/** The Places to Fetch choices, as the page offers them. */
export const PLACES_CHOICES = [
  { label: 'First Location Only', value: 'first' },
  { label: `All Locations (up to ${MOST_PLACES})`, value: 'all' },
];

/** The Refresh Interval choices, in minutes, as the page offers them. */
export const REFRESH_MINUTES = ['15', '30', '60', '120'];

/** The value a unit reads while it follows the Pebble app. */
export const APP_UNIT = 'app';

/** What the page calls that choice, with the Pebble app's own unit after it once the plugin says what that is. */
export const APP_UNIT_LABEL = 'Pebble App';

/** The message the settings page sends the plugin for the Pebble app's units. */
export const UNITS_MESSAGE = 'weather-enhanced-units';

/** Each unit row, against the name its unit goes by in the framework's weather units. */
export const UNIT_ROWS = { TEMPERATURE_UNIT: 'temperature', WIND_UNIT: 'windSpeed', PRESSURE_UNIT: 'pressure' } as const;

/** Each unit's choices past the Pebble app's own, saved under the names the framework's weather source serves them in. */
export const UNIT_CHOICES = {
  TEMPERATURE_UNIT: [
    { label: 'Celsius (°C)', value: '°C' },
    { label: 'Fahrenheit (°F)', value: '°F' },
  ],
  WIND_UNIT: [
    { label: 'Kilometres/hour (km/h)', value: 'km/h' },
    { label: 'Miles/hour (mph)', value: 'mph' },
    { label: 'Knots (kts)', value: 'knots' },
    { label: 'Metres/second (m/s)', value: 'm/s' },
  ],
  PRESSURE_UNIT: [
    { label: 'Hectopascals (hPa)', value: 'hPa' },
    { label: 'Inches of Mercury (inHg)', value: 'inHg' },
  ],
};

/**
 * The provider the settings pick, falling back to Open-Meteo for a value the page never offered.
 *
 * @param saved The saved Data Source.
 * @return The provider.
 */
export function providerOf(saved: unknown): Provider {
  return PROVIDERS.find((provider) => provider.id === saved) || OPEN_METEO;
}
