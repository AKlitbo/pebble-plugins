/**
 * Specs for the page code that shows each feed's status under it, run against a stand-in for the Clay
 * page and the plugin's real answer to the page.
 *
 * What is pinned is what the wearer reads: when the feed was last fetched and how many events it gave,
 * the last failure in words, and nothing at all while the plugin never answers. A status for a link
 * the wearer has just edited would describe the old link, so typing in it has to swap the status out.
 * Clay's `set` fires `change` when it fills the saved settings in, which must not count as an edit.
 */

import { describe, test, expect } from 'vitest';
import type { ClayConfigItem } from '../../paf/ts/clay/types';
import type { ClayPage, ClayPageRow } from '../../paf/ts/plugin-app/page-types';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { SETTINGS_KEY } from '../../paf/ts/plugin-app/settings';
import { feedEvents } from '../plugin/feeds';
import type { Feed } from '../plugin/feeds';
import { handlePage } from '../plugin/page-bridge';
import { clayConfig } from './index';
import statusPage from './status-page';

// Wednesday 4 November 2026, 12:00 in Toronto
const NOW_MS = Date.UTC(2026, 10, 4, 17);

const LINK = 'https://example.com/team.ics';

const FEED: Feed = { slot: 1, on: true, name: 'Team', url: LINK };

/** A feed of one meeting, Thursday 5 November 2026 at 15:00 UTC. */
const CALENDAR = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:standup@example.com', 'DTSTART:20261105T150000Z', 'DTEND:20261105T153000Z', 'SUMMARY:Standup', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

/** Every row on the page, sections opened up. */
function rows(items: ClayConfigItem[]): ClayConfigItem[] {
  return items.flatMap((item) => (item.items ? rows(item.items) : [item]));
}

/** A phone with both feeds on, the first with a link, its storage after these fetches of the first. */
async function phoneAfter(...answers: Array<string | Error>) {
  const items = new Map<string, string>([[SETTINGS_KEY, JSON.stringify({ FEED1_ON: true, FEED2_ON: true })]]);
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };

  for (let turn = 0; turn < answers.length; turn++) {
    const answer = answers[turn];

    await feedEvents(FEED, 5, NOW_MS + turn * 5 * 60 * 1000, async () => (answer instanceof Error ? Promise.reject(answer) : answer), storage);
  }

  return storage;
}

/**
 * One of the first feed's rows as Clay draws it, a link box or a select. Its `set` fires Clay's
 * `change` the way Clay's does when it fills the saved settings in. `type` fires the box's own `input`
 * as typing does, and `pick` its own `change` as picking a choice does.
 */
function feedRow() {
  const changes: Array<() => void> = [];
  const listeners: Array<{ name: string; listener: () => void }> = [];
  const box = { addEventListener: (name: string, listener: () => void) => void listeners.push({ name, listener }) };
  const fire = (name: string) => listeners.filter((each) => each.name === name).forEach((each) => each.listener());
  const row = {
    $element: [{ querySelector: (selector: string) => (selector.split(', ').some((part) => part === 'input' || part === 'select') ? box : null) }],
    on: (name: string, handler: () => void) => void (name === 'change' ? changes.push(handler) : undefined),
    set: () => changes.forEach((handler) => handler()),
  };

  return { row, set: () => row.set(), type: () => fire('input'), pick: () => fire('change') };
}

/**
 * Opens the page code against the plugin's answer for that storage, or with the plugin never
 * answering, and gives back each status row's text and the first feed's link row.
 */
async function openPage(storage: Awaited<ReturnType<typeof phoneAfter>>, answers = true) {
  let handler: ((message: unknown, respond: (reply: unknown) => void) => void | Promise<void>) | null = null;
  const pebble = {
    registerConfigHandler: (registered: typeof handler) => void (handler = registered),
    refreshSources: () => undefined,
    secureStorage: { getItem: async (key: string) => (key === 'FEED1_URL' ? LINK : null), setItem: async () => undefined, removeItem: async () => undefined },
  } as unknown as PluginPebble;

  handlePage(pebble, storage);

  const statusRows = rows(clayConfig).filter((item) => String(item.id).startsWith('cei-status-'));
  const elements: Record<string, { textContent: string }> = { 'cei-status-1': { textContent: '' }, 'cei-status-2': { textContent: '' } };
  const link = feedRow();
  const country = feedRow();
  let built: () => void = () => undefined;
  let ready: (event: { target: string }) => void = () => undefined;
  const page = {
    EVENTS: { AFTER_BUILD: 'after-build' },
    on: (_event: string, run: () => void) => void (built = run),
    getItemById: (id: string) => {
      const config = statusRows.find((item) => item.id === id);

      return config ? ({ config: { moduleOptions: config.moduleOptions }, $element: [elements[id]] } as unknown as ClayPageRow) : undefined;
    },
    getItemByMessageKey: (key: string) => ({ FEED1_URL: link.row, FEED1_COUNTRY: country.row })[key] as unknown as ClayPageRow | undefined,
  };
  const ask = async (message: unknown) => {
    let reply: unknown = null;

    await handler!(message, (answer) => void (reply = answer));

    return reply;
  };

  (globalThis as unknown as { window: unknown }).window = {
    Pebble: {
      addEventListener: (name: string, listener: typeof ready) => void (name === 'ready' ? (ready = listener) : undefined),
      sendMessage: (_target: string, message: unknown) => (answers ? ask(message) : new Promise(() => undefined)),
    },
  };

  // the stand-in has only the parts of the Clay page the page code reaches
  statusPage.call(page as unknown as ClayPage);
  built();
  ready({ target: 'plugin' });

  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve();
  }

  return { shown: () => ['cei-status-1', 'cei-status-2'].map((id) => elements[id].textContent), link, country };
}

describe('the feed statuses', () => {
  /** The wearer has to see a working feed as working, with what it gave, and a feed with nothing yet as not fetched. */
  test('show the last fetch and its count under a fetched feed, and Not fetched yet under the other', async () => {
    const storage = await phoneAfter(CALENDAR);

    const { shown } = await openPage(storage);

    const result = shown();

    expect(result).toEqual([expect.stringMatching(/^Last fetched .+, with 1 event\.$/), 'Not fetched yet.']);
  });

  /** A feed that stopped working has to say why in words, beside when it last worked. */
  test('show the last failure in words beside the last good fetch', async () => {
    const storage = await phoneAfter(CALENDAR, new Error('HTTP 404'));

    const { shown } = await openPage(storage);

    const result = shown()[0];

    expect(result).toMatch(/^Last fetched .+, with 1 event\. The last try, .+, failed, since the server answered HTTP 404\.$/);
  });

  /** A sign-in page in place of the calendar is the usual way a private link goes bad. */
  test('name an answer that is not iCal', async () => {
    const storage = await phoneAfter('<html>Sign in</html>');

    const { shown } = await openPage(storage);

    const result = shown()[0];

    expect(result).toMatch(/^Not fetched yet\. The last try, .+, failed, since the link didn't give an iCal calendar\.$/);
  });

  /** A timeout and a site the Pebble app has not allowed each have their own fix, so each has to say which it was. */
  test.each([
    ['fetch timeout: https://example.com/team.ics', 'TypeError', "the server didn't answer in time"],
    ['not allowed', 'NotAllowedError', "the Pebble app hasn't allowed the site"],
  ])('name a %s failure in words', async (message, name, words) => {
    const storage = await phoneAfter(Object.assign(new Error(message), { name }));

    const { shown } = await openPage(storage);

    const result = shown()[0];

    expect(result).toContain(`failed, since ${words}.`);
  });

  /** The old link's status under a new link would tell the wearer something about a link they no longer have. */
  test('swap the status out when the wearer types in the link', async () => {
    const storage = await phoneAfter(CALENDAR);
    const { shown, link } = await openPage(storage);

    link.type();

    const result = shown()[0];

    expect(result).toBe('This feed is fetched on the next run after you save.');
  });

  /** Another country is another feed, so the old country's status under it would describe something else. */
  test('swap the status out when the wearer picks another country', async () => {
    const storage = await phoneAfter(CALENDAR);
    const { shown, country } = await openPage(storage);

    country.pick();

    const result = shown()[0];

    expect(result).toBe('This feed is fetched on the next run after you save.');
  });

  /** Clay fills the saved link in with `set`, which fires `change`, and a note then would hide every feed's real status. */
  test('keep the status when Clay fills the saved link in', async () => {
    const storage = await phoneAfter(CALENDAR);
    const { shown, link, country } = await openPage(storage);

    link.set();
    country.set();

    const result = shown()[0];

    expect(result).toMatch(/^Last fetched /);
  });

  /** The runtime can leave the ask unanswered, and the rows must stay empty rather than say something untrue. */
  test('stay empty while the plugin never answers', async () => {
    const storage = await phoneAfter(CALENDAR);

    const { shown } = await openPage(storage, false);

    const result = shown();

    expect(result).toEqual(['', '']);
  });
});
