/**
 * Specs for Calendar Enhanced + iCal's answers to its settings page, against a stand-in for the plugin
 * runtime.
 *
 * The calendars ask reads no secret, so it has to answer while the keystore is locked, and it must not
 * read the phone at all while Show Phone Calendars is off. A message the plugin does not know has to
 * reach the framework, which answers it, or the page waits on it for good.
 */

import { describe, test, expect } from 'vitest';
import type { PluginPebble, SourceRequest } from '../../paf/ts/plugin-app/runtime';
import { SAVE_MESSAGE, SETTINGS_KEY } from '../../paf/ts/plugin-app/settings';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';
import { CALENDARS_MESSAGE } from '../settings';
import { mergeAgenda } from './agenda';
import { handlePage } from './page-bridge';
import { syncPins } from './pins';

// Wednesday 4 November 2026, 12:00 in Toronto
const NOW_MS = Date.UTC(2026, 10, 4, 17);

/** The built-in's update, one meeting on Thursday 5 November in the Work calendar. */
const WORK: SourceEnvelope = {
  instances: [{ instanceId: '0', properties: { starts_at: { timestamp: { value: Date.UTC(2026, 10, 5, 14) / 1000 } }, calendar: { longText: { text: 'Work' } } } }],
};

/** The plugin's answers with these settings saved and the keystore readable or locked, and the reads it made. */
function bridgeWith(saved: Record<string, unknown>, locked = false) {
  const items = new Map<string, string>([[SETTINGS_KEY, JSON.stringify(saved)]]);
  const read: SourceRequest[] = [];
  const pins = new Map<string, unknown>();
  let handler: ((message: unknown, respond: (reply: unknown) => void) => void | Promise<void>) | null = null;
  const pebble = {
    insertTimelinePin: (pin: { id: string }) => void pins.set(pin.id, pin),
    deleteTimelinePin: (id: string) => void pins.delete(id),
    registerConfigHandler: (registered: typeof handler) => void (handler = registered),
    readSource: async (request: SourceRequest) => {
      read.push(request);

      return WORK;
    },
    refreshSources: () => undefined,
    secureStorage: {
      getItem: async () => {
        if (locked) {
          throw new Error('keystore locked');
        }

        return null;
      },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    },
  } as unknown as PluginPebble;

  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };

  handlePage(pebble, storage, () => NOW_MS);

  const ask = async (message: unknown) => {
    let reply: unknown = null;

    await handler!(message, (answer) => void (reply = answer));

    return reply;
  };

  return { ask, read, pins, pebble, storage };
}

describe('the calendars ask', () => {
  /** The list reads no link, and a locked keystore would otherwise leave the wearer with no switches. */
  test('answers while the keystore is locked', async () => {
    const { ask } = bridgeWith({ HIDDEN_CALENDARS: JSON.stringify(['Family']) }, true);

    const result = await ask({ type: CALENDARS_MESSAGE });

    expect(result).toEqual({ calendars: ['Work'], hidden: ['Family'] });
  });

  /** With Show Phone Calendars off the page hides the list, so reading the phone would only spend time. */
  test('reads nothing with Show Phone Calendars off', async () => {
    const { ask, read } = bridgeWith({ PHONE_CALENDARS: false, HIDDEN_CALENDARS: JSON.stringify(['Family']) });

    const result = [await ask({ type: CALENDARS_MESSAGE }), read.length];

    expect(result).toEqual([{ calendars: [], hidden: ['Family'] }, 0]);
  });
});

describe('a message the plugin does not know', () => {
  /** Unanswered, the page would wait on it until it gave up. */
  test("falls through to the framework's answer", async () => {
    const { ask } = bridgeWith({});

    const result = await ask({ type: 'something-else' });

    expect(result).toEqual({ error: 'the plugin does not know that message' });
  });
});

describe('a save that turns the pins off', () => {
  /** Nothing may read the calendar for hours, so waiting for the next run would leave the pins on the timeline. */
  test('deletes the pins there and then', async () => {
    const { ask, pins, pebble, storage } = bridgeWith({ TIMELINE_PINS: true });

    await syncPins(pebble, storage, mergeAgenda([], [{ source: 'feed1', events: [{ startEpoch: NOW_MS / 1000 + 3600, endEpoch: NOW_MS / 1000 + 7200, allDay: false, title: 'Standup', location: '' }] }], NOW_MS / 1000, {}, undefined, 200), { on: true, reminderMinutes: null, nowMs: NOW_MS });
    await ask({ type: SAVE_MESSAGE, settings: { TIMELINE_PINS: false } });

    const result = pins.size;

    expect(result).toBe(0);
  });
});
