/**
 * Calendar + iCal's settings, shared by its settings page and its plugin script, so the keys, their
 * defaults, and which ones are secret are written once.
 *
 * The two feed links are secret, since a private iCal link works like a password, so the plugin keeps
 * them in the phone's encrypted storage. The refresh is how many minutes a feed is kept before it is
 * fetched again. The look ahead is how many days the agenda holds, today counted.
 */

import type { SettingsOptions } from '../paf/ts/plugin-app/settings';

/** Every setting's key and the value it opens on. */
export const DEFAULTS = {
  PHONE_CALENDARS: true,
  FEED1_ON: false,
  FEED1_NAME: 'Feed 1',
  FEED1_URL: '',
  FEED2_ON: false,
  FEED2_NAME: 'Feed 2',
  FEED2_URL: '',
  REFRESH: '30',
  LOOK_AHEAD: '7',
};

/** What the framework's settings helpers are told about these settings. */
export const SETTINGS_OPTIONS: SettingsOptions = {
  secret: ['FEED1_URL', 'FEED2_URL'],
  defaults: DEFAULTS,
  refresh: ['calendar/event'],
};

/** The Refresh Interval choices, in minutes, as the page offers them. */
export const REFRESH_MINUTES = ['5', '10', '15', '20', '30', '60'];

/**
 * The Look Ahead choices, in days with today counted, as the page offers them. A month is 31 days,
 * the longest a month runs.
 */
export const LOOK_AHEAD_DAYS = ['1', '3', '7', '14', '31'];

/**
 * The days the agenda holds, from the saved Look Ahead.
 *
 * Clay saves a select as text, so the value is matched against the choices as text. Anything else,
 * such as settings saved with no Look Ahead in them, reads as the week.
 *
 * @param value The saved Look Ahead.
 * @return One of the choices as a number of days, or the week's 7.
 */
export function lookAheadDays(value: unknown): number {
  const days = String(value);

  return Number(LOOK_AHEAD_DAYS.includes(days) ? days : DEFAULTS.LOOK_AHEAD);
}
