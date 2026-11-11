/**
 * Specs for Calendar + iCal's settings page against the settings the plugin reads.
 *
 * The page and the plugin each take their defaults from settings.ts, and the plugin reads a setting
 * the wearer never saved as its default. A row opening on another value would show one thing and serve
 * another. The feed links are the other thing worth pinning, since a link left out of the secret list
 * goes to the phone's plain storage.
 */

import { describe, test, expect } from 'vitest';
import { clayConfig } from './index';
import { DEFAULTS, SETTINGS_OPTIONS } from '../settings';
import type { ClayConfigItem } from '../../paf/ts/clay/types';

/** Every row on the page that saves a setting, with the value it opens on, sections opened up. */
function savedRows(items: ClayConfigItem[]): Record<string, unknown> {
  const rows: Record<string, unknown> = {};

  for (const item of items) {
    if (item.items) {
      Object.assign(rows, savedRows(item.items));
    } else if (item.messageKey) {
      rows[item.messageKey] = item.defaultValue;
    }
  }

  return rows;
}

describe('the settings page', () => {
  /** A row on another default, or a setting with no row, serves something the page never showed. */
  test('opens every setting on the default the plugin reads', () => {
    const result = savedRows(clayConfig);

    expect(result).toEqual(DEFAULTS);
  });

  /** A feed link out of the secret list lands in plain storage, and a private link works like a password. */
  test('keeps both feed links secret', () => {
    const result = SETTINGS_OPTIONS.secret;

    expect(result).toEqual(['FEED1_URL', 'FEED2_URL']);
  });
});
