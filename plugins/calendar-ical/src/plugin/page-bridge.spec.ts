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
import { SETTINGS_KEY } from '../../paf/ts/plugin-app/settings';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';
import { CALENDARS_MESSAGE } from '../settings';
import { handlePage } from './page-bridge';

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
  let handler: ((message: unknown, respond: (reply: unknown) => void) => void | Promise<void>) | null = null;
  const pebble = {
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
    },
  } as unknown as PluginPebble;

  handlePage(pebble, { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value), removeItem: (key) => void items.delete(key) }, () => NOW_MS);

  const ask = async (message: unknown) => {
    let reply: unknown = null;

    await handler!(message, (answer) => void (reply = answer));

    return reply;
  };

  return { ask, read };
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
