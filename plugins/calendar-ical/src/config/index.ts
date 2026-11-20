/**
 * Calendar Enhanced + iCal's settings page. The framework builds it into the pbw's config.html,
 * loads the saved settings from the plugin when it opens, and hands them back on Save. Its page code
 * asks the plugin for each feed's status and shows it under the feed.
 */

import type { ClayConfigItem } from '../../paf/ts/clay/types';
import { CALLOUT_BADGE, CALLOUT_BOX } from '../../paf/ts/clay/callout-style';
import { subheading } from '../../paf/ts/pkjs/config-rows';
import { combineCustomFns } from '../../paf/ts/clay/custom-fn';
import hiddenStore from '../../paf/ts/clay/hidden-store-component';
import { HOLIDAY_CALENDARS, automaticNames } from '../holidays';
import { CALENDARS_MESSAGE, DEFAULTS, FEED_SOURCES, HIDE_STARTED_CHOICES, LOOK_AHEAD_DAYS, PIN_REMINDER_CHOICES, REFRESH_MINUTES, STATUS_MESSAGE, TIME_LABEL_CHOICES } from '../settings';
import type { FeedSource } from '../settings';
import holidaysPage from './holidays-page';
import type { HolidaysOptions } from './holidays-page';
import calendarsPage from './calendars-page';
import type { CalendarsOptions } from './calendars-page';
import statusPage from './status-page';
import type { StatusOptions } from './status-page';

/** How the Look Ahead select names each of its day counts. */
const LOOK_AHEAD_LABELS: Record<string, string> = { 1: 'Today', 3: '3 Days', 7: '1 Week', 14: '2 Weeks', 31: '1 Month' };

/** How the Hide Events in Progress select names each of its choices. */
const HIDE_STARTED_LABELS: Record<string, string> = { never: 'Never', 0: 'When They Start', 15: '15 Minutes After', 30: '30 Minutes After', 60: '60 Minutes After' };

/** How the Time Labels select names each of its choices. */
const TIME_LABEL_NAMES: Record<(typeof TIME_LABEL_CHOICES)[number], string> = { builtIn: 'Same as the Pebble App (14:30)', short: 'Short (2:30p, Thu, Nov 27)' };


/** What the calendar list row hands the page code. */
const CALENDARS_OPTIONS: CalendarsOptions = { calendarsMessage: CALENDARS_MESSAGE, storeKey: 'HIDDEN_CALENDARS' };

/** Each country's holiday name, by the value its Country choice saves. */
function holidayNames(): Record<string, string> {
  const names: Record<string, string> = {};

  for (const calendar of HOLIDAY_CALENDARS) {
    names[calendar.id] = calendar.name;
  }

  return names;
}

/** How the Reminder select names each of its choices. */
const PIN_REMINDER_NAMES: Record<string, string> = { none: 'None', 0: 'When It Starts', 5: '5 Minutes Before', 10: '10 Minutes Before', 15: '15 Minutes Before', 30: '30 Minutes Before', 60: '1 Hour Before' };

/** How the Source select names each of its choices. */
const FEED_SOURCE_NAMES: Record<FeedSource, string> = { ical: 'iCal Link', holidays: 'Public Holidays' };

/** What the first Country select hands the page code, which fills an unnamed feed's name from it. */
const HOLIDAYS_OPTIONS: HolidaysOptions = {
  feeds: ([1, 2] as const).map((slot) => ({ source: `FEED${slot}_SOURCE`, country: `FEED${slot}_COUNTRY`, name: `FEED${slot}_NAME`, automatic: automaticNames(DEFAULTS[`FEED${slot}_NAME`]) })),
  names: holidayNames(),
};

/** What the first status row hands the page code, which finds every status row and link from it. */
const STATUS_OPTIONS: StatusOptions = {
  statusMessage: STATUS_MESSAGE,
  rows: ['cei-status-1', 'cei-status-2'],
  edits: ([1, 2] as const).map((slot) => [`FEED${slot}_URL`, `FEED${slot}_SOURCE`, `FEED${slot}_COUNTRY`, `FEED${slot}_OBSERVANCES`]),
};

/** One iCal feed's section, with its name, its link, and its status shown only while the feed is on. */
function feedSection(slot: 1 | 2): ClayConfigItem {
  const on = `FEED${slot}_ON` as const;
  const source = `FEED${slot}_SOURCE` as const;
  const name = `FEED${slot}_NAME` as const;
  const country = `FEED${slot}_COUNTRY` as const;
  const observances = `FEED${slot}_OBSERVANCES` as const;
  const url = `FEED${slot}_URL` as const;
  const shown = { key: on, in: [true] };

  return {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: `iCal Feed ${slot}` },
      { type: 'toggle', messageKey: on, label: `Show iCal Feed ${slot}`, defaultValue: DEFAULTS[on] },
      {
        type: 'select',
        messageKey: source,
        label: 'Source',
        defaultValue: DEFAULTS[source],
        options: FEED_SOURCES.map((choice) => ({ label: FEED_SOURCE_NAMES[choice], value: choice })),
        visibleWhen: shown,
      },
      { type: 'input', messageKey: name, label: 'Name', defaultValue: DEFAULTS[name], visibleWhen: shown },
      {
        type: 'select',
        messageKey: country,
        label: 'Country',
        defaultValue: DEFAULTS[country],
        options: HOLIDAY_CALENDARS.map((calendar) => ({ label: calendar.country, value: calendar.id })),
        moduleOptions: slot === 1 ? HOLIDAYS_OPTIONS : undefined,
        visibleWhen: [shown, { key: source, in: ['holidays'] }],
      },
      {
        type: 'toggle',
        messageKey: observances,
        label: 'Include Observances',
        description: "Adds days like Valentine's Day or Mother's Day that aren't days off. Leave it off for just the public holidays.",
        defaultValue: DEFAULTS[observances],
        visibleWhen: [shown, { key: source, in: ['holidays'] }],
      },
      { type: 'text', defaultValue: "The holidays come from Google's public holiday calendars.", visibleWhen: [shown, { key: source, in: ['holidays'] }] },
      { type: 'input', messageKey: url, label: 'iCal Link', defaultValue: DEFAULTS[url], attributes: { type: 'url', placeholder: 'https://' }, visibleWhen: [shown, { key: source, in: ['ical'] }] },
      // the page code fills this in once the plugin answers, and it stays empty when the plugin never does
      { type: 'text', id: `cei-status-${slot}`, defaultValue: '', moduleOptions: slot === 1 ? STATUS_OPTIONS : undefined, visibleWhen: shown },
    ],
  };
}

/**
 * A warning in the framework's callout look, the orange box with a "!" badge its location notes use.
 * A Clay text row draws its value as HTML, so the row carries the box's rules with it.
 */
function warning(text: string): string {
  return `<style>.cei-warning { ${CALLOUT_BOX} margin: 0; } .cei-warning:before { ${CALLOUT_BADGE} }</style><span class="cei-warning" style="display: block">${text}</span>`;
}

export const clayConfig: ClayConfigItem[] = [
  { type: 'heading', defaultValue: 'Calendar Enhanced + iCal' },
  { type: 'text', defaultValue: "Puts your phone's calendars and up to two iCal links into one agenda for your watchfaces." },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Phone Calendars' },
      { type: 'toggle', messageKey: 'PHONE_CALENDARS', label: 'Show Phone Calendars', defaultValue: DEFAULTS.PHONE_CALENDARS },
      // the page code fills this row with a switch for each calendar once the plugin answers
      {
        type: 'text',
        id: 'cei-calendars',
        defaultValue: 'Switch a calendar off to keep it off your watchfaces. Only calendars with events this week are listed, and two with the same name share a switch.',
        moduleOptions: CALENDARS_OPTIONS,
        visibleWhen: { key: 'PHONE_CALENDARS', in: [true] },
      },
      { type: 'hiddenStore', messageKey: 'HIDDEN_CALENDARS', storeClass: 'cei-hidden-calendars', defaultValue: DEFAULTS.HIDDEN_CALENDARS },
    ],
  },
  feedSection(1),
  feedSection(2),
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'iCal Updates' },
      {
        type: 'select',
        messageKey: 'REFRESH',
        label: 'iCal Refresh Interval',
        description: 'How often your iCal links are checked for changes. Phone calendars update on their own.',
        defaultValue: DEFAULTS.REFRESH,
        options: REFRESH_MINUTES.map((minutes) => ({ label: minutes === '60' ? '1 Hour' : `${minutes} Minutes`, value: minutes })),
      },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Agenda' },
      {
        type: 'select',
        messageKey: 'LOOK_AHEAD',
        label: 'Look Ahead',
        description: 'How far ahead events are shown, from today only to a month.',
        defaultValue: DEFAULTS.LOOK_AHEAD,
        options: LOOK_AHEAD_DAYS.map((days) => ({ label: LOOK_AHEAD_LABELS[days], value: days })),
      },
      // the built-in Calendar plugin shares only the next 7 days of the phone's calendars
      // so the note shows for the choices longer than that, while the phone's calendars are shown
      { type: 'text', defaultValue: warning('Phone calendars only reach 7 days ahead. iCal links use the full Look Ahead.'), visibleWhen: [{ key: 'LOOK_AHEAD', in: LOOK_AHEAD_DAYS.filter((days) => Number(days) > 7) }, { key: 'PHONE_CALENDARS', in: [true] }] },
      {
        type: 'select',
        messageKey: 'HIDE_STARTED',
        label: 'Hide Events in Progress',
        description: "Hides a meeting once it starts, or after the time you pick, so your watchface shows what's next. All-day and multi-day events stay until they end.",
        defaultValue: DEFAULTS.HIDE_STARTED,
        options: HIDE_STARTED_CHOICES.map((choice) => ({ label: HIDE_STARTED_LABELS[choice], value: choice })),
      },
      {
        type: 'toggle',
        messageKey: 'ALL_DAY_EVENTS',
        label: 'Show All-Day Events',
        description: 'Turn off to hide birthdays, holidays, and other all-day events.',
        defaultValue: DEFAULTS.ALL_DAY_EVENTS,
      },
      {
        type: 'input',
        messageKey: 'HIDE_TITLED',
        label: 'Hide Events Titled',
        description: 'Hides events with any of these words in the title, separated by commas, such as Lunch, Focus Time.',
        defaultValue: DEFAULTS.HIDE_TITLED,
        attributes: { type: 'text', autocapitalize: 'off', placeholder: 'Lunch, Focus Time' },
      },
      // the built-in Calendar plugin reads whether the wearer is going from the phone but sends none of it
      subheading('iCal Links Only'),
      { type: 'text', defaultValue: "The Pebble app doesn't share these for phone calendars." },
      {
        type: 'toggle',
        messageKey: 'HIDE_DECLINED',
        label: 'Hide Declined Events',
        description: 'Hides invitations you said no to. It needs your email addresses.',
        defaultValue: DEFAULTS.HIDE_DECLINED,
      },
      {
        type: 'toggle',
        messageKey: 'HIDE_TENTATIVE',
        label: 'Hide Tentative Events',
        description: 'Hides invitations you answered Maybe to, and events the organizer marked tentative. Your Maybe needs your email addresses.',
        defaultValue: DEFAULTS.HIDE_TENTATIVE,
      },
      {
        type: 'input',
        messageKey: 'EMAIL_ADDRESSES',
        label: 'Your Email Addresses',
        description: 'The email addresses your invitations go to, separated by commas, so the switches above can find your answer.',
        defaultValue: DEFAULTS.EMAIL_ADDRESSES,
        // a plain text box, so a list is never checked as one address, still with the email keyboard
        attributes: { type: 'text', inputmode: 'email', autocapitalize: 'off', autocorrect: 'off', placeholder: 'you@example.com' },
        visibleWhen: { anyOf: [{ key: 'HIDE_DECLINED', in: [true] }, { key: 'HIDE_TENTATIVE', in: [true] }] },
      },
      {
        type: 'toggle',
        messageKey: 'HIDE_FREE',
        label: 'Hide Free Events',
        description: 'Hides timed events that show you as free, like holds. All-day events stay, since holiday calendars mark every holiday as free.',
        defaultValue: DEFAULTS.HIDE_FREE,
      },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Timeline' },
      {
        type: 'toggle',
        messageKey: 'TIMELINE_PINS',
        label: 'Pin iCal Events to the Timeline',
        description: "Adds your iCal events to the watch's timeline, like the Pebble app does for phone calendars. Pins update while a watchface is showing your calendar.",
        defaultValue: DEFAULTS.TIMELINE_PINS,
      },
      {
        type: 'select',
        messageKey: 'PIN_REMINDER',
        label: 'Reminder',
        description: 'How long before an event to remind you. All-day events get no reminder.',
        defaultValue: DEFAULTS.PIN_REMINDER,
        options: PIN_REMINDER_CHOICES.map((choice) => ({ label: PIN_REMINDER_NAMES[choice], value: choice })),
        visibleWhen: { key: 'TIMELINE_PINS', in: [true] },
      },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Event Text' },
      {
        type: 'select',
        messageKey: 'TIME_LABELS',
        label: 'Time Labels',
        description: "How event times are written on watchfaces that show them as text. Same as the Pebble App always shows the time, like 14:30, even for an event next week. Short shows the time for today's events, like 2:30p on a 12-hour clock, and the day for later ones, like Thu or Nov 27. Many watchfaces write times their own way and ignore this.",
        defaultValue: DEFAULTS.TIME_LABELS,
        options: TIME_LABEL_CHOICES.map((choice) => ({ label: TIME_LABEL_NAMES[choice], value: choice })),
      },
    ],
  },
  { type: 'submit', defaultValue: 'Save' },
];

/** The framework's hidden store, which carries the switched off calendars through a save. */
export const components = [hiddenStore];

/** The page code, which shows each feed's status under it and lists the phone's calendars. */
export const customClay = combineCustomFns([
  { code: statusPage, label: 'the feed statuses' },
  { code: calendarsPage, label: 'the phone calendar list' },
  { code: holidaysPage, label: 'the holiday feed names' },
]);
