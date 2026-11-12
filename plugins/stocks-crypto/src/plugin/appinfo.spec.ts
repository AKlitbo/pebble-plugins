/**
 * Specs for what Stocks + Crypto declares in its appinfo.
 *
 * The appinfo is JSON, so its `finance` source is a hand copy of the framework's `STOCK_SOURCE`, which
 * declares what `stockInstance` sends, serving both the `stock` and the `crypto` item. The Pebble app
 * drops any property the copy leaves out. Each provider's site needs its own Internet permission, or the
 * Pebble app turns its fetch away.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test, expect } from 'vitest';
import { STOCK_SOURCE } from '../../paf/ts/plugin-app/stocks';
import { PROVIDERS } from '../settings';

const APPINFO = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', 'pebble.appinfo.json'), 'utf8'));

/** One usesPermissions entry as the appinfo writes it. */
interface Permission {
  name: string;
  parameters: { domains: string[] };
  required: boolean;
  reason: string;
}

describe('the appinfo', () => {
  /**
   * A property the copy leaves out never reaches a face. Both items share the stock source's
   * properties, so a face reads `finance/crypto` the way it reads `finance/stock`, and an item left out
   * is one the Pebble app never asks for.
   */
  test('declares the stock and crypto items with the properties the framework serves', () => {
    const result = APPINFO.plugin.sources;

    expect(result).toEqual([{ ...STOCK_SOURCE, items: ['stock', 'crypto'] }]);
  });

  /** A provider's site with no permission is turned away, and a required one would have the wearer allow all four. */
  test("asks for each provider's site on its own, none of them required", () => {
    const result = APPINFO.usesPermissions.map((permission: Permission) => [permission.name, permission.parameters.domains, permission.required, permission.reason.length > 0]);

    expect(result).toEqual(PROVIDERS.map((provider) => ['Internet', [provider.domain], false, true]));
  });
});
