/**
 * Specs for the watchlist page code's style rules.
 *
 * Clay's base sheet gives every button a 12rem minimum width and an auto margin, and the phone showed
 * the rows and Add buttons pushed far past the screen. A spec lays nothing out, so what is pinned is
 * the cause: every rule the page code writes for its buttons sets its own width and takes the margin
 * back off.
 */

import { describe, test, expect } from 'vitest';
import watchlistPage from './watchlist-page';

/** The page code's own rules for its buttons, read out of its source as Clay pastes it into the page. */
function buttonRules(): string[] {
  // a build can write the strings in either kind of quote
  return String(watchlistPage).match(/['"]\.sc-list-box[^'"]*button \{[^'"]*\}['"]/g) || [];
}

describe('the watchlist page style', () => {
  /** A button left at Clay's 12rem pushes its row past the screen, as the phone showed. */
  test("takes Clay's 12rem minimum width and margin off every button", () => {
    const result = buttonRules().map((rule) => /min-width: (0|44px);/.test(rule) && rule.includes('margin: 0;'));

    expect(result).toEqual([true, true]);
  });
});
