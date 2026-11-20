/**
 * Calendar Enhanced + iCal's answers to its settings page.
 *
 * The framework's `handleSettings` loads and saves the settings. Its message hook also answers the
 * page's ask for each feed's status, which the page shows under the feed. A status is only ever when
 * the feed was fetched, how many events it gave, and the kind of its last failure, never the link. It
 * also answers the page's ask for the phone's calendars, with the ones the saved settings switch off.
 * A save that turns Pin iCal Events to the Timeline off deletes the pins there and then.
 */

import { handleSettings, readSettings } from '../../paf/ts/plugin-app/settings';
import type { SettingsStorage } from '../../paf/ts/plugin-app/settings';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { CALENDARS_MESSAGE, SETTINGS_OPTIONS, STATUS_MESSAGE, hiddenCalendars, switchOn } from '../settings';
import { feedStatus } from './feeds';
import type { FeedStatus, FeedStorage } from './feeds';
import { phoneCalendarNames } from './phone';
import { syncPins } from './pins';
import type { PinStorage } from './pins';
import type { PhoneStorage } from './phone';
import { feedOf, readAll } from './serve';

/**
 * Each feed's status, for the link it has now, in slot order.
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param storage Where the settings, the copies, and the statuses are kept, normally `localStorage`.
 * @return The statuses, with null for a feed that is off, has no link, or has nothing kept.
 */
export async function feedStatuses(pebble: PluginPebble, storage: SettingsStorage & FeedStorage): Promise<{ feeds: Array<FeedStatus | null> }> {
  const { settings, linksRead } = await readAll(pebble, storage);

  return { feeds: [feedStatus(feedOf(settings, 1, linksRead), storage), feedStatus(feedOf(settings, 2, linksRead), storage)] };
}

/**
 * The phone's calendars for the page's list, and the ones switched off. The switched off ones come
 * from the same saved settings the page loads, so the list and the page's own copy always agree.
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param storage Where the settings and the phone's last good read are kept, normally `localStorage`.
 * @param nowMs The time now.
 * With Show Phone Calendars off the phone is not read at all and the list is empty, since the page
 * hides it then anyway.
 *
 * @return The calendars, sorted, the names switched off, which can include calendars not listed, and
 *   the reason for a refused read.
 */
export async function phoneCalendars(pebble: PluginPebble, storage: SettingsStorage & PhoneStorage, nowMs: number): Promise<{ calendars: string[]; hidden: string[]; error?: string }> {
  // the secret keys play no part in the list, so they are left unread, which keeps the ask working while the keystore is locked
  const settings = await readSettings({ defaults: SETTINGS_OPTIONS.defaults }, pebble, storage);
  const hidden = hiddenCalendars(settings.HIDDEN_CALENDARS);

  if (!switchOn(settings, 'PHONE_CALENDARS')) {
    return { calendars: [], hidden };
  }

  return { ...(await phoneCalendarNames(pebble, nowMs, storage)), hidden };
}

/**
 * Answers the settings page: the framework's load and save, and the page's asks for the feeds'
 * statuses and the phone's calendars.
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param storage Where the settings, the copies, the statuses, and the phone's read are kept, normally `localStorage`.
 * @param clock Reads the time now, normally `Date.now`.
 */
export function handlePage(pebble: PluginPebble, storage: SettingsStorage & FeedStorage & PhoneStorage & PinStorage, clock: () => number = Date.now): void {
  handleSettings(SETTINGS_OPTIONS, pebble, storage, {
    // a message of any other type goes unanswered here, and the framework answers it with its error
    onMessage: async (type, _message, respond) => {
      if (type === STATUS_MESSAGE) {
        respond(await feedStatuses(pebble, storage));
      } else if (type === CALENDARS_MESSAGE) {
        respond(await phoneCalendars(pebble, storage, clock()));
      }
    },
    // turning the pins off takes them off the timeline straight away, since no run may come while nothing reads the calendar
    onSaved: async (before, after) => {
      if (switchOn(before, 'TIMELINE_PINS') && !switchOn(after, 'TIMELINE_PINS')) {
        await syncPins(pebble, storage, [], { on: false, reminderMinutes: null, nowMs: clock() });
      }
    },
  });
}
