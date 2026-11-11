/**
 * Calendar + iCal's settings, shared by its settings page and its plugin script, so the keys, their
 * defaults, and which ones are secret are written once.
 *
 * The two feed links are secret, since a private iCal link works like a password, so the plugin keeps
 * them in the phone's encrypted storage. The refresh is how many minutes a feed is kept before it is
 * fetched again.
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
};

/** What the framework's settings helpers are told about these settings. */
export const SETTINGS_OPTIONS: SettingsOptions = {
  secret: ['FEED1_URL', 'FEED2_URL'],
  defaults: DEFAULTS,
  refresh: ['calendar/event'],
};

/** The Refresh Interval choices, in minutes, as the page offers them. */
export const REFRESH_MINUTES = ['5', '10', '15', '20', '30', '60'];
