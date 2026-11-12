/**
 * Specs for Stocks + Crypto's settings page against the settings the plugin reads.
 *
 * The page and the plugin each take their defaults from settings.ts, and the plugin reads a setting
 * the wearer never saved as its default. A row opening on another value would show one thing and serve
 * another. The keys are the other thing worth pinning. A key left out of the secret list goes to the
 * phone's plain storage, and a key row shown under the wrong provider is saved where it is never read.
 */

import { describe, test, expect } from 'vitest';
import { clayConfig } from './index';
import { DEFAULTS, PROVIDERS, SETTINGS_OPTIONS } from '../settings';
import type { ClayConfigItem } from '../../paf/ts/clay/types';

/** Every row on the page, sections opened up. */
function rows(items: ClayConfigItem[]): ClayConfigItem[] {
  return items.flatMap((item) => (item.items ? rows(item.items) : [item]));
}

describe('the settings page', () => {
  /** A row on another default, or a setting with no row, serves something the page never showed. */
  test('opens every setting on the default the plugin reads', () => {
    const result = Object.fromEntries(rows(clayConfig).filter((item) => item.messageKey).map((item) => [item.messageKey, item.defaultValue]));

    expect(result).toEqual(DEFAULTS);
  });

  /** A key out of the secret list lands in plain storage. */
  test('keeps every API key secret', () => {
    const result = SETTINGS_OPTIONS.secret;

    expect(result).toEqual(['FINNHUB_KEY', 'TWELVEDATA_KEY', 'ALPHAVANTAGE_KEY']);
  });

  /** A key or Paid Plan row shown under another provider would be saved where that provider never reads it. */
  test('shows each key and Paid Plan row only while its provider is picked', () => {
    const keyed = PROVIDERS.filter((provider) => provider.keySetting);
    const shownFor = (messageKey: string | undefined) => rows(clayConfig).find((item) => item.messageKey === messageKey)?.visibleWhen;

    const result = keyed.map((provider) => [shownFor(provider.keySetting), shownFor(provider.paidSetting)]);

    expect(result).toEqual(keyed.map((provider) => [{ key: 'PROVIDER', in: [provider.id] }, { key: 'PROVIDER', in: [provider.id] }]));
  });
});
