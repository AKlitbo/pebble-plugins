/**
 * Specs for the page code that lists the phone's calendars with a switch each, run against a stand-in
 * for the Clay page, a small stand-in for the page's document, and the plugin's real answer.
 *
 * What is pinned is what a save carries. A switch flipped off has to put its calendar's name in the
 * hidden store, and one flipped on has to take it out. A name switched off that has no events this
 * week has to stay switched off, or it comes back on by itself. A page left untouched must write
 * nothing, and the framework's late load of the saved settings must not undo a flip.
 *
 * A refusal has to read as Calendar not allowed rather than an empty week, a name from the phone has to
 * land as text, and only the plugin's own `ready` may send the ask.
 */

import { describe, test, expect } from 'vitest';
import type { ClayConfigItem } from '../../paf/ts/clay/types';
import type { ClayPage, ClayPageRow } from '../../paf/ts/plugin-app/page-types';
import type { PluginPebble, SourceRequest } from '../../paf/ts/plugin-app/runtime';
import { SETTINGS_KEY } from '../../paf/ts/plugin-app/settings';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';
import { handlePage } from '../plugin/page-bridge';
import { clayConfig } from './index';
import calendarsPage from './calendars-page';

// Wednesday 4 November 2026, 12:00 in Toronto
const NOW_MS = Date.UTC(2026, 10, 4, 17);

/**
 * Just enough of an element for the page code: children, text, a class, and a checkbox's state. Its
 * `innerHTML` holds markup only when markup was written, so text written as text reads back escaped.
 */
class FakeElement {
  children: FakeElement[] = [];
  className = '';
  type = '';
  checked = false;
  onchange: (() => void) | null = null;
  attributes: Record<string, string> = {};
  private text = '';
  private markup: string | null = null;

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);

    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.text = value;
    this.markup = null;
    this.children = [];
  }

  get innerHTML(): string {
    return this.markup ?? this.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  set innerHTML(value: string) {
    this.markup = value;
    this.children = [];
  }

  /** Every element under this one, this one first. */
  all(): FakeElement[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

/** The built-in's update, one event in each named calendar on Thursday 5 November. */
function updateWith(...calendars: string[]): SourceEnvelope {
  return {
    instances: calendars.map((calendar, index) => ({
      instanceId: String(index),
      properties: {
        name: { shortText: { text: 'Meeting' }, longText: { text: 'Meeting' } },
        starts_at: { timestamp: { value: Date.UTC(2026, 10, 5, 14 + index) / 1000 } },
        ends_at: { timestamp: { value: Date.UTC(2026, 10, 5, 15 + index) / 1000 } },
        all_day: { boolean: { value: false } },
        calendar: { shortText: { text: calendar }, longText: { text: calendar } },
      },
    })),
  };
}

/** Every row on the page, sections opened up. */
function rows(items: ClayConfigItem[]): ClayConfigItem[] {
  return items.flatMap((item) => (item.items ? rows(item.items) : [item]));
}

/** How a spec bends the page's talk with the plugin. */
interface Talk {
  /** Set to false for a plugin that never answers. */
  answers?: boolean;
  /** An answer given in place of the plugin's own. */
  reply?: unknown;
  /** The target the `ready` event names, the plugin's own when left out. */
  target?: string;
}

/**
 * Opens the page code with these settings saved and the built-in answering with these calendars, with
 * the talk bent as asked. Gives back the rows' switches, what the store holds, how many asks went out,
 * and a way to stand in for the framework's late load of the saved settings.
 */
async function openPage(saved: Record<string, unknown>, calendars: SourceEnvelope | Error, talk: Talk = {}) {
  const items = new Map<string, string>([[SETTINGS_KEY, JSON.stringify(saved)]]);
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };
  let handler: ((message: unknown, respond: (reply: unknown) => void) => void | Promise<void>) | null = null;
  const pebble = {
    registerConfigHandler: (registered: typeof handler) => void (handler = registered),
    readSource: async (request: SourceRequest) => {
      if (calendars instanceof Error || request.category !== 'calendar') {
        throw calendars instanceof Error ? calendars : new Error('not in the spec');
      }

      return calendars;
    },
    refreshSources: () => undefined,
    secureStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
  } as unknown as PluginPebble;

  handlePage(pebble, storage, () => NOW_MS);

  const listRow = rows(clayConfig).find((item) => item.id === 'cei-calendars') as ClayConfigItem;
  const holder = new FakeElement();
  const changes: Array<() => void> = [];
  let stored = String(saved.HIDDEN_CALENDARS ?? '');
  let writes = 0;
  const store = {
    get: () => stored,
    set: (value: string) => {
      stored = value;
      writes++;
      changes.forEach((run) => run());
    },
    on: (name: string, run: () => void) => void (name === 'change' ? changes.push(run) : undefined),
  };
  let built: () => void = () => undefined;
  let ready: (event: { target: string }) => void = () => undefined;
  const page = {
    EVENTS: { AFTER_BUILD: 'after-build' },
    on: (_event: string, run: () => void) => void (built = run),
    getItemById: (id: string) => (id === 'cei-calendars' ? ({ config: { moduleOptions: listRow.moduleOptions }, $element: [holder] } as unknown as ClayPageRow) : undefined),
    getItemByMessageKey: (key: string) => (key === 'HIDDEN_CALENDARS' ? (store as unknown as ClayPageRow) : undefined),
  };
  let asks = 0;
  const ask = async (message: unknown) => {
    let reply: unknown = null;

    asks++;

    if ('reply' in talk) {
      return talk.reply;
    }


    await handler!(message, (answer) => void (reply = answer));

    return reply;
  };

  (globalThis as unknown as { document: unknown }).document = { createElement: () => new FakeElement(), head: new FakeElement() };
  (globalThis as unknown as { window: unknown }).window = {
    Pebble: {
      addEventListener: (name: string, listener: typeof ready) => void (name === 'ready' ? (ready = listener) : undefined),
      sendMessage: (_target: string, message: unknown) => (talk.answers === false ? new Promise(() => undefined) : ask(message)),
    },
  };

  // the stand-in has only the parts of the Clay page the page code reaches
  calendarsPage.call(page as unknown as ClayPage);
  built();
  ready({ target: talk.target ?? 'plugin' });

  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve();
  }

  const switches = () => holder.all().filter((element) => element.type === 'checkbox');

  return {
    shown: () => switches().map((input) => [input.attributes['aria-label'], input.checked]),
    flip: (index: number) => {
      const input = switches()[index];

      input.checked = !input.checked;
      input.onchange!();
    },
    stored: () => stored,
    writes: () => writes,
    asks: () => asks,
    names: () => holder.all().filter((element) => element.className === 'cei-name').map((element) => element.innerHTML),
    tags: () => holder.all().filter((element) => element.className === 'cei-tag').map((element) => element.textContent),
    note: () => holder.all().filter((element) => element.className === 'cei-note').map((element) => element.textContent)[0],
    // the framework's load sets the store the way Clay does, firing change, but it is not the page's write
    load: (value: string) => {
      stored = value;
      changes.forEach((run) => run());
    },
  };
}

describe('the phone calendar list', () => {
  /** The wearer has to see each of their calendars, sorted, with the ones they switched off shown off. */
  test('shows a switch for each calendar, off for the ones saved as hidden', async () => {
    const page = await openPage({ HIDDEN_CALENDARS: JSON.stringify(['Work']) }, updateWith('Work', 'Family', 'Work'));

    const result = page.shown();

    expect(result).toEqual([
      ['Show Family on watchfaces', true],
      ['Show Work on watchfaces', false],
    ]);
  });

  /** A switch that does not reach the store is lost on Save, and the calendar stays on the watch. */
  test('saves a calendar switched off, and keeps one hidden that has no events this week', async () => {
    const page = await openPage({ HIDDEN_CALENDARS: JSON.stringify(['Holidays']) }, updateWith('Work', 'Family'));

    page.flip(1);

    const result = page.stored();

    expect(JSON.parse(result)).toEqual(['Holidays', 'Work']);
  });

  /** Switching a calendar back on has to take it out of the list, or it never shows again. */
  test('takes a calendar switched back on out of the store', async () => {
    const page = await openPage({ HIDDEN_CALENDARS: JSON.stringify(['Work']) }, updateWith('Work'));

    page.flip(0);

    const result = page.stored();

    expect(result).toBe('');
  });

  /** A page opened and saved untouched must keep what was saved, not rewrite it. */
  test('writes nothing while no switch is flipped', async () => {
    const page = await openPage({ HIDDEN_CALENDARS: JSON.stringify(['Work']) }, updateWith('Work', 'Family'));

    const result = page.writes();

    expect(result).toBe(0);
  });

  /** The framework loads the saved settings after the page is built, and that load must not undo the wearer's flip. */
  test("puts a flip back over the framework's late load", async () => {
    const page = await openPage({}, updateWith('Work', 'Family'));

    page.flip(1);
    page.load('');

    const result = page.stored();

    expect(JSON.parse(result)).toEqual(['Work']);
  });

  /** A refusal read as an empty week would tell the wearer they have no events, rather than that Calendar is not allowed. */
  test('says Calendar is not allowed when the read is refused, with no switches', async () => {
    const page = await openPage({ HIDDEN_CALENDARS: JSON.stringify(['Work']) }, Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' }));

    const result = [page.shown(), page.note(), page.writes()];

    expect(result).toEqual([[], expect.stringContaining("hasn't allowed"), 0]);
  });

  /** A calendar switched off with no events this week would otherwise have no switch to turn it back on. */
  test('shows a hidden calendar with no events this week as switched off and marked', async () => {
    const page = await openPage({ HIDDEN_CALENDARS: JSON.stringify(['Holidays']) }, updateWith('Work'));

    const result = [page.shown(), page.tags()];

    expect(result).toEqual([
      [
        ['Show Work on watchfaces', true],
        ['Show Holidays on watchfaces', false],
      ],
      ['No Events This Week'],
    ]);
  });

  /** Turning a quiet calendar back on has to take it out of the store, or it never shows again. */
  test('takes a quiet calendar turned back on out of the store', async () => {
    const page = await openPage({ HIDDEN_CALENDARS: JSON.stringify(['Holidays', 'Work']) }, updateWith('Work'));

    page.flip(1);

    const result = page.stored();

    expect(JSON.parse(result)).toEqual(['Work']);
  });

  /** The framework's late load with nothing flipped must stand, since it is the saved value. */
  test('keeps a late load and writes nothing while no switch is flipped', async () => {
    const page = await openPage({ HIDDEN_CALENDARS: JSON.stringify(['Work']) }, updateWith('Work', 'Family'));

    page.load(JSON.stringify(['Work']));

    const result = [page.stored(), page.writes()];

    expect(result).toEqual([JSON.stringify(['Work']), 0]);
  });

  /** A calendar name comes from the phone, and written as markup it could run on the settings page. */
  test('writes a calendar name as text, never as markup', async () => {
    const page = await openPage({}, updateWith('<b>x</b>'));

    const result = page.names();

    expect(result).toEqual(['&lt;b&gt;x&lt;/b&gt;']);
  });

  /** An answer carrying an error has no list to trust, and switches drawn from it could save over the wearer's choices. */
  test('draws no switches and writes nothing for an answer with an error', async () => {
    const page = await openPage({ HIDDEN_CALENDARS: JSON.stringify(['Work']) }, updateWith('Work'), { reply: { calendars: ['Work'], hidden: [], error: 'the plugin does not know that message' } });

    const result = [page.shown(), page.writes()];

    expect(result).toEqual([[], 0]);
  });

  /** The page's other parts also hear `ready`, and only the plugin's own may send the ask. */
  test("asks nothing when the ready event is not the plugin's", async () => {
    const page = await openPage({}, updateWith('Work'), { target: 'watch' });

    const result = [page.asks(), page.shown()];

    expect(result).toEqual([0, []]);
  });

  /** The runtime can leave the ask unanswered, and the page must keep the saved switches as they were. */
  test('shows no switches and writes nothing while the plugin never answers', async () => {
    const page = await openPage({ HIDDEN_CALENDARS: JSON.stringify(['Work']) }, updateWith('Work'), { answers: false });

    const result = [page.shown(), page.writes()];

    expect(result).toEqual([[], 0]);
  });
});
