// @vitest-environment jsdom
/**
 * Specs for the watchlist page code, run against a stand-in for the Clay page and the plugin's own
 * answers to the page.
 *
 * The list lives in a hidden row the framework saves with the rest of the page, so whatever the page
 * code writes there is what the plugin serves. What is pinned is that nothing the wearer does is lost
 * or saved by mistake: a change made while an add is out has to survive the answer, and Enter in the
 * Add box has to add rather than submit the page, which the framework saves and closes.
 *
 * Clay's base sheet gives every button a 12rem minimum width and an auto margin, and the phone showed
 * the rows and Add buttons pushed far past the screen. jsdom lays nothing out, so for that what is
 * pinned is the cause: every rule the page code writes for its buttons takes that width and margin
 * back off.
 */

import { beforeEach, describe, test, expect } from 'vitest';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { SETTINGS_KEY } from '../../paf/ts/plugin-app/settings';
import { handlePage } from '../plugin/page-bridge';
import { SETTINGS_OPTIONS } from '../settings';
import watchlistPage from './watchlist-page';
import type { WatchlistOptions } from './watchlist-page';

type Entry = { ticker: string; kind: string };

const OPTIONS: WatchlistOptions = {
  defaultList: [{ ticker: '^GSPC', kind: 'stock' }],
  alphaVantageCap: 4,
  perKind: 8,
  addMessage: 'stocks-crypto-add',
  namesMessage: 'stocks-crypto-names',
  calloutBox: '',
  calloutBadge: '',
};

/** Lets every answer already given land. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

/**
 * Opens the page code on a list, inside a form the way Clay's page sits in one, with the plugin's own
 * answers behind the bridge. Its add answers can be held back and let go later.
 */
function openPage(list: Entry[]) {
  document.head.innerHTML = '';
  document.body.innerHTML = '<form id="clay"><div id="holder"></div><input type="submit" value="Save"></form>';

  let value = JSON.stringify(list);
  const changed: Array<() => void> = [];
  const store = { config: {}, $element: [document.createElement('div')], get: () => value, set: (next: unknown) => (String(next) !== value ? ((value = String(next)), changed.forEach((run) => run())) : undefined), hide: () => undefined, on: (_event: string, run: () => void) => void changed.push(run) };
  const holder = { config: { moduleOptions: OPTIONS }, $element: [document.getElementById('holder') as HTMLElement], get: () => '', set: () => undefined, hide: () => undefined, on: () => undefined };
  let built: () => void = () => undefined;
  const page = {
    EVENTS: { AFTER_BUILD: 'after-build' },
    on: (_event: string, run: () => void) => void (built = run),
    getItemById: (id: string) => (id === 'sc-watchlist' ? holder : undefined),
    getItemByMessageKey: (key: string) => (key === 'WATCHLIST' ? store : undefined),
  };

  // the plugin side, the real answers to the page
  const plain = new Map<string, string>([[SETTINGS_KEY, '{}']]);
  let answer: ((message: unknown, respond: (reply: unknown) => void) => void | Promise<void>) | null = null;
  const plugin = { registerConfigHandler: (handler: typeof answer) => void (answer = handler), refreshSources: () => undefined, secureStorage: { getItem: async () => null } } as unknown as PluginPebble;

  handlePage(SETTINGS_OPTIONS, plugin, { getItem: (key) => plain.get(key) ?? null, setItem: (key, text) => void plain.set(key, text) });

  const held: Array<() => void> = [];
  const state = { hold: false, submits: 0, asked: 0 };

  (window as unknown as { Pebble: unknown }).Pebble = {
    addEventListener: () => undefined,
    sendMessage: (_target: string, message: unknown) => new Promise((resolve) => {
      state.asked++;

      const go = () => void answer!(message, resolve);

      if (state.hold) {
        held.push(go);
      } else {
        go();
      }
    }),
  };
  document.getElementById('clay')!.addEventListener('submit', (event) => (event.preventDefault(), state.submits++));
  watchlistPage.call(page as never);
  built();

  const input = document.querySelector('.sc-add input') as HTMLInputElement;
  const tickers = () => (JSON.parse(value) as Entry[]).map((entry) => entry.ticker);
  const add = async (ticker: string, kind: 'Stock' | 'Crypto') => {
    input.value = ticker;
    ([...document.querySelectorAll('.sc-buttons button')].find((button) => button.textContent === `Add ${kind}`) as HTMLElement).click();
    await settle();
  };
  const tap = async (label: string) => {
    (document.querySelector(`[aria-label="${label}"]`) as HTMLElement).click();
    await settle();
  };
  const answerAll = async () => {
    held.splice(0).forEach((go) => go());
    await settle();
  };

  return { input, tickers, add, tap, answerAll, state };
}

/** The page code's own rules for its buttons, read out of its source as Clay pastes it into the page. */
function buttonRules(): string[] {
  // a build can write the strings in either kind of quote
  return String(watchlistPage).match(/['"]\.sc-list-box[^'"]*button \{[^'"]*\}['"]/g) || [];
}

describe('the watchlist page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** The answer once replaced the whole list, so a ticker dropped while it was out came back. */
  test('keeps a drop made while an add is out', async () => {
    const page = openPage([{ ticker: 'AAPL', kind: 'stock' }, { ticker: 'MSFT', kind: 'stock' }]);

    page.state.hold = true;
    await page.add('goog', 'Stock');
    await page.tap('Drop MSFT');

    await page.answerAll();
    const result = page.tickers();

    expect(result).toEqual(['AAPL', 'GOOG']);
  });

  /** Two adds out at once each answered against the list as it was, and only the last one was kept. */
  test('keeps both of two adds made before either is answered', async () => {
    const page = openPage([{ ticker: 'AAPL', kind: 'stock' }]);

    page.state.hold = true;
    await page.add('NVDA', 'Stock');
    await page.add('TSLA', 'Stock');

    await page.answerAll();
    const result = page.tickers();

    expect(result).toEqual(['AAPL', 'NVDA', 'TSLA']);
  });

  /** The same ticker added twice before either answer lands would show twice and spend two calls. */
  test('keeps a ticker added twice before either answer once', async () => {
    const page = openPage([{ ticker: 'AAPL', kind: 'stock' }]);

    page.state.hold = true;
    await page.add('NVDA', 'Stock');
    await page.add('nvda', 'Stock');

    await page.answerAll();
    const result = page.tickers();

    expect(result).toEqual(['AAPL', 'NVDA']);
  });

  /** A double tap asked for the same ticker twice, and the second answer told the wearer it was already on the list. */
  test('asks once for a ticker tapped twice before it is answered', async () => {
    const page = openPage([{ ticker: 'AAPL', kind: 'stock' }]);

    page.state.hold = true;
    await page.add('NVDA', 'Stock');
    await page.add('NVDA', 'Stock');
    await page.answerAll();

    const result = [page.state.asked, page.tickers()];

    expect(result).toEqual([1, ['AAPL', 'NVDA']]);
  });

  /** Enter submitted the page's form, which the framework saves and closes, with the ticker never added. */
  test('adds the ticker on Enter rather than submitting the page', async () => {
    const page = openPage([{ ticker: 'AAPL', kind: 'stock' }]);

    page.input.value = 'GOOG';

    page.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    const result = [page.tickers(), page.state.submits, page.input.form];

    expect(result).toEqual([['AAPL', 'GOOG'], 0, null]);
  });

  /** The arrows next to the × were easy to mix up on the phone, so the whole row now lies between them. */
  test('puts the arrows at the start of each row and the × alone at the end', () => {
    openPage([{ ticker: 'AAPL', kind: 'stock' }, { ticker: 'MSFT', kind: 'stock' }]);
    const row = document.querySelector('.sc-list-box li') as HTMLElement;

    const result = [[...(row.firstElementChild as HTMLElement).querySelectorAll('button')].map((button) => button.getAttribute('aria-label')), row.lastElementChild?.getAttribute('aria-label')];

    expect(result).toEqual([['Move AAPL up', 'Move AAPL down'], 'Drop AAPL']);
  });

  /** A button left at Clay's 12rem pushes its row past the screen, as the phone showed. */
  test("takes Clay's 12rem minimum width and margin off every button", () => {
    const result = buttonRules().map((rule) => /min-width: (0|44px);/.test(rule) && rule.includes('margin: 0;'));

    expect(result).toEqual([true, true]);
  });
});
