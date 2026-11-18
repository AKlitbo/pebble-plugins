/**
 * Specs for Weather Enhanced's settings page against the settings the plugin reads.
 *
 * The page and the plugin each take their defaults from settings.ts, and the plugin reads a setting
 * the wearer never saved as its default. A row opening on another value would show one thing and serve
 * another. The keys are the other thing worth pinning. A key left out of the secret list goes to the
 * phone's plain storage, and a key row shown under the wrong provider is saved where it is never read.
 * The credits under Save are what each provider's terms ask for, so the picked one has to be named.
 * The place list is JSON in a row of its own, which the wearer should never see as text, and Add a
 * Place saves only through it. A Places to Fetch from before the list rides in a hidden row too, since
 * a save replaces every setting.
 */

import { describe, test, expect } from 'vitest';
import { clayConfig } from './index';
import { DEFAULTS, PROVIDERS, SETTINGS_OPTIONS } from '../settings';
import type { ClayConfigItem } from '../../paf/ts/clay/types';

/** Every row on the page, sections opened up. */
function rows(items: ClayConfigItem[]): ClayConfigItem[] {
  return items.flatMap((item) => (item.items ? rows(item.items) : [item]));
}

/** The row saved under a key. */
function rowOf(messageKey: string | undefined): ClayConfigItem | undefined {
  return rows(clayConfig).find((item) => item.messageKey === messageKey);
}

describe('the settings page', () => {
  /** A row on another default, or a setting with no row, serves something the page never showed. */
  test('opens every setting on the default the plugin reads', () => {
    const result = Object.fromEntries(rows(clayConfig).filter((item) => item.messageKey).map((item) => [item.messageKey, item.defaultValue]));

    expect(result).toEqual(DEFAULTS);
  });

  /**
   * A fresh install has no key, so anything but Open-Meteo would serve nothing until the wearer finds
   * the setting. An empty place list serves every place in the Pebble app's order.
   */
  test('opens on Open-Meteo, Pebble App Places on, an empty place list, 30 minutes, and the Pebble app units', () => {
    const result = ['PROVIDER', 'USE_APP_PLACES', 'PLACE_LIST', 'REFRESH', 'TEMPERATURE_UNIT', 'WIND_UNIT', 'PRESSURE_UNIT'].map((key) => rowOf(key)?.defaultValue);

    expect(result).toEqual(['openmeteo', true, '[]', '30', 'app', 'app', 'app']);
  });

  /**
   * The search and the Name are only the way to a new entry in the place list. Either one with a key
   * would save the last pick or name as a setting of its own, which nothing reads.
   */
  test('saves nothing from the Add a Place rows', () => {
    const result = rows(clayConfig).filter((item) => ['we-add-search', 'we-add-name', 'we-add'].includes(String(item.id))).map((item) => [item.type, item.messageKey]);

    expect(result).toEqual([
      ['locationsearch', undefined],
      ['input', undefined],
      ['button', undefined],
    ]);
  });

  /**
   * A text box of JSON on the page would be the first thing a wearer edits by hand. A save replaces
   * every setting, so a Places to Fetch with no row would be dropped by the first save.
   */
  test('keeps the place list and the old Places to Fetch in hidden inputs', () => {
    const result = ['PLACE_LIST', 'PLACES'].map((key) => [rowOf(key)?.type, rowOf(key)?.attributes]);

    expect(result).toEqual([
      ['input', { type: 'hidden' }],
      ['input', { type: 'hidden' }],
    ]);
  });

  /** A key out of the secret list lands in plain storage. */
  test('keeps every API key secret', () => {
    const result = SETTINGS_OPTIONS.secret;

    expect(result).toEqual(['OWM_KEY', 'WEATHERAPI_KEY']);
  });

  /** A key or Paid Plan row shown under another provider would be saved where that provider never reads it. */
  test('shows each key and Paid Plan row only while its provider is picked', () => {
    const result = PROVIDERS.map((provider) => [provider.id, rowOf(provider.keySetting)?.visibleWhen, rowOf(provider.paidSetting)?.visibleWhen]);

    expect(result).toEqual([
      ['openmeteo', undefined, undefined],
      ['owm', { key: 'PROVIDER', in: ['owm'] }, { key: 'PROVIDER', in: ['owm'] }],
      ['weatherapi', { key: 'PROVIDER', in: ['weatherapi'] }, { key: 'PROVIDER', in: ['weatherapi'] }],
    ]);
  });

  /**
   * Open-Meteo fills the forecast whichever provider is picked, so its CC BY credit always shows. The
   * keyed provider's own credit shows only while it is picked, and all of them sit under Save.
   */
  test('credits Open-Meteo always and the picked keyed provider under Save', () => {
    const footer = clayConfig.slice(clayConfig.findIndex((item) => item.type === 'submit') + 1);

    const result = footer.map((item) => [String(item.defaultValue).replace(/<[^>]+>/g, ''), item.visibleWhen]);

    expect(result).toEqual([
      ['Weather data by Open-Meteo.com under CC\u00a0BY\u00a04.0.', undefined],
      ['Weather data © OpenWeather.', { key: 'PROVIDER', in: ['owm'] }],
      ['Powered by WeatherAPI.com.', { key: 'PROVIDER', in: ['weatherapi'] }],
    ]);
  });

  /** A credit line without the framework's pf-footer class sits to the left, since the page carries no rule of its own to centre it. */
  test('marks every credit line under Save pf-footer', () => {
    const footer = clayConfig.slice(clayConfig.findIndex((item) => item.type === 'submit') + 1);

    const result = footer.filter((item) => !String(item.defaultValue).startsWith('<div class="pf-footer">'));

    expect(result).toEqual([]);
  });
});
