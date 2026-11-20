/**
 * Calendar Enhanced + iCal's settings, shared by its settings page and its plugin script, so the keys,
 * their defaults, and which ones are secret are written once.
 *
 * The hidden calendars are the names of the phone's calendars the wearer switched off, as a JSON list.
 * Each feed follows an iCal link or a country's public holidays, and a holiday feed's link is built
 * from its country rather than saved.
 * The two feed links are secret, since a private iCal link works like a password, so the plugin keeps
 * them in the phone's encrypted storage. The refresh is how many minutes a feed is kept before it is
 * fetched again. The look ahead is how many days the agenda holds, today counted. The rest are the
 * agenda's filters, how long after its start a timed event leaves it, whether all-day events show,
 * whether the feeds' declined, tentative, and free events show, and which titles stay off. The email addresses are how a
 * feed's guest list says which guest is the wearer. The time labels are how each event's start and end
 * read as text. The pins are whether the feeds' events go on the timeline, and how long before a
 * pinned event starts its reminder shows.
 */

import type { SettingsOptions } from '../paf/ts/plugin-app/settings';
import { DEFAULT_COUNTRY } from './holidays';

/** Every setting's key and the value it opens on. */
export const DEFAULTS = {
  PHONE_CALENDARS: true,
  HIDDEN_CALENDARS: '',
  FEED1_ON: false,
  FEED1_SOURCE: 'ical',
  FEED1_NAME: 'Feed 1',
  FEED1_COUNTRY: DEFAULT_COUNTRY,
  FEED1_OBSERVANCES: false,
  FEED1_URL: '',
  FEED2_ON: false,
  FEED2_SOURCE: 'ical',
  FEED2_NAME: 'Feed 2',
  FEED2_COUNTRY: DEFAULT_COUNTRY,
  FEED2_OBSERVANCES: false,
  FEED2_URL: '',
  REFRESH: '30',
  LOOK_AHEAD: '7',
  HIDE_STARTED: 'never',
  ALL_DAY_EVENTS: true,
  HIDE_DECLINED: false,
  EMAIL_ADDRESSES: '',
  HIDE_TENTATIVE: false,
  HIDE_FREE: false,
  HIDE_TITLED: '',
  TIME_LABELS: 'builtIn',
  TIMELINE_PINS: false,
  PIN_REMINDER: '15',
};

/** The settings the page saves as a switch, on or off. */
export type SwitchKey = { [Key in keyof typeof DEFAULTS]: (typeof DEFAULTS)[Key] extends boolean ? Key : never }[keyof typeof DEFAULTS];

/**
 * Whether a switch is on, from the saved settings.
 *
 * The saved settings sit over the defaults, so settings saved before a switch existed read it as its
 * default. Anything but true or false, which the page never saves, reads as the default too.
 *
 * @param settings The saved settings, over the defaults.
 * @param key The switch.
 * @return Whether it is on.
 */
export function switchOn(settings: Record<string, unknown>, key: SwitchKey): boolean {
  const value = settings[key];

  return typeof value === 'boolean' ? value : DEFAULTS[key];
}

/** What the framework's settings helpers are told about these settings. */
export const SETTINGS_OPTIONS: SettingsOptions = {
  secret: ['FEED1_URL', 'FEED2_URL'],
  defaults: DEFAULTS,
  refresh: ['calendar/event'],
};

/** The Source choices for a feed, as the page offers them: iCal Link and Public Holidays. */
export const FEED_SOURCES = ['ical', 'holidays'] as const;

/** Where a feed's events come from. */
export type FeedSource = (typeof FEED_SOURCES)[number];

/**
 * Where a feed's events come from, from its saved Source.
 *
 * Anything but Public Holidays, such as settings saved before a feed had a Source, reads as an iCal
 * link, so a feed set up before keeps its link.
 *
 * @param value The saved Source.
 * @return `holidays` for Public Holidays, and `ical` for anything else.
 */
export function feedSourceOf(value: unknown): FeedSource {
  return value === 'holidays' ? 'holidays' : 'ical';
}

/**
 * The Reminder choices for a pinned event, as the page offers them: none, at the start, or the minutes
 * before it.
 */
export const PIN_REMINDER_CHOICES = ['none', '0', '5', '10', '15', '30', '60'];

/**
 * The minutes before a pinned event's start that its reminder shows, from the saved Reminder.
 *
 * Clay saves a select as text, so the value is matched against the choices as text. Anything else,
 * such as settings saved with no Reminder in them, reads as the page's default.
 *
 * @param value The saved Reminder.
 * @return The minutes, or null for no reminder.
 */
export function pinReminderMinutes(value: unknown): number | null {
  const choice = PIN_REMINDER_CHOICES.includes(String(value)) ? String(value) : DEFAULTS.PIN_REMINDER;

  return choice === 'none' ? null : Number(choice);
}

/** The message the settings page sends to ask for each feed's status. */
export const STATUS_MESSAGE = 'calendar-ical-status';

/** The message the settings page sends to ask for the phone's calendars. */
export const CALENDARS_MESSAGE = 'calendar-ical-calendars';

/**
 * The names of the phone's calendars the wearer switched off, from the saved Hidden Calendars.
 *
 * The page saves them as a JSON list. Anything that does not read back as one, such as settings saved
 * before the list existed, reads as none, so every calendar shows. An entry that is not a name is left out.
 *
 * @param value The saved Hidden Calendars.
 * @return The names, as saved.
 */
export function hiddenCalendars(value: unknown): string[] {
  try {
    const names = JSON.parse(typeof value === 'string' && value ? value : '[]');

    return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string' && name.length > 0) : [];
  } catch {
    return [];
  }
}

/** The iCal Refresh Interval choices, in minutes, as the page offers them. */
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

/**
 * The Hide Events in Progress choices, as the page offers them. Each is the minutes after its start
 * that a timed event leaves the agenda, apart from `never`, which keeps it until it ends.
 */
export const HIDE_STARTED_CHOICES = ['never', '0', '15', '30', '60'];

/**
 * The minutes after its start that a timed event leaves the agenda, from the saved Hide Events in
 * Progress.
 *
 * Clay saves a select as text, so the value is matched against the choices as text. Anything else,
 * such as settings saved with no Hide Events in Progress in them, reads as never.
 *
 * @param value The saved Hide Events in Progress.
 * @return One of the choices as a number of minutes, or null to keep every event until it ends.
 */
export function hideStartedMinutes(value: unknown): number | null {
  const minutes = String(value);

  return minutes !== 'never' && HIDE_STARTED_CHOICES.includes(minutes) ? Number(minutes) : null;
}

/**
 * The Time Labels choices, as the page offers them. `builtIn` is Match the Pebble App, the built-in
 * Calendar plugin's `HH:MM` whatever the day, and `short` is Short Labels.
 */
export const TIME_LABEL_CHOICES = ['builtIn', 'short'] as const;

/**
 * The style an event's start and end are labelled in, from the saved Time Labels.
 *
 * Anything but Short Labels, such as settings saved with no Time Labels in them, reads as Match the
 * Pebble App, so a wearer who switches from the built-in sees the same text.
 *
 * @param value The saved Time Labels.
 * @return `short` for Short Labels, and `builtIn` for anything else.
 */
export function timeLabelStyle(value: unknown): (typeof TIME_LABEL_CHOICES)[number] {
  return value === 'short' ? 'short' : 'builtIn';
}

/**
 * The wearer's email addresses, from the saved Your Email Addresses box.
 *
 * The box takes a list, so the text is split on commas, semicolons, and spaces, and the empty pieces
 * are left out. The iCal reader ignores case and `mailto:` when it matches them.
 *
 * @param value The saved Your Email Addresses.
 * @return The addresses, in the order typed, and none for anything that is not text.
 */
export function emailAddresses(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/[\s,;]+/).filter((address) => address.length > 0) : [];
}
