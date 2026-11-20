/**
 * Calendar Enhanced + iCal's settings page. The framework builds it into the pbw's config.html,
 * loads the saved settings from the plugin when it opens, and hands them back on Save. Its page code
 * asks the plugin for each feed's status and shows it under the feed.
 */

import type { ClayConfigItem } from '../../paf/ts/clay/types';
import { CALLOUT_BADGE, CALLOUT_BOX } from '../../paf/ts/clay/callout-style';
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
const TIME_LABEL_NAMES: Record<(typeof TIME_LABEL_CHOICES)[number], string> = { builtIn: 'Match the Pebble App', short: 'Short Labels' };


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
        description: "Adds days such as Valentine's Day or Mother's Day that aren't days off. Off, the feed has the public holidays alone.",
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
  { type: 'text', defaultValue: "Serves your phone's calendars and up to two iCal links, merged into one agenda, to every watchface that reads calendar plugins." },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Phone Calendars' },
      { type: 'toggle', messageKey: 'PHONE_CALENDARS', label: 'Show Phone Calendars', defaultValue: DEFAULTS.PHONE_CALENDARS },
      // the page code fills this row with a switch for each calendar once the plugin answers
      {
        type: 'text',
        id: 'cei-calendars',
        defaultValue: "Switch a calendar off to keep its events off your watchfaces. The list shows the calendars with events in the next 7 days, since that's all the Pebble app shares. The Pebble app's own calendar switches still decide which calendars it reads and pins to the timeline. Two calendars with the same name share one switch, since the Pebble app only shares the name.",
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
        description: "How old an iCal feed's copy can get before the plugin fetches it again. A shorter time picks up changes to a feed sooner and uses a little more data. Your phone's calendars stay up to date on their own.",
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
        description: 'How far ahead the agenda reaches, from today only to a month. A watchface shows as many of these events as it has room for.',
        defaultValue: DEFAULTS.LOOK_AHEAD,
        options: LOOK_AHEAD_DAYS.map((days) => ({ label: LOOK_AHEAD_LABELS[days], value: days })),
      },
      // the built-in Calendar plugin shares only the next 7 days of the phone's calendars
      // so the note shows for the choices longer than that, while the phone's calendars are shown
      { type: 'text', defaultValue: warning("Phone calendars only reach a week ahead, since that's all the Pebble app shares. Your iCal feeds use the full Look Ahead."), visibleWhen: [{ key: 'LOOK_AHEAD', in: LOOK_AHEAD_DAYS.filter((days) => Number(days) > 7) }, { key: 'PHONE_CALENDARS', in: [true] }] },
      {
        type: 'select',
        messageKey: 'HIDE_STARTED',
        label: 'Hide Events in Progress',
        description: "Takes a meeting off the agenda once it starts, or once it has been going the time you pick, so your watchface shows what's next rather than what you're already in. All-day events, and anything that runs a day or more, stay until they end.",
        defaultValue: DEFAULTS.HIDE_STARTED,
        options: HIDE_STARTED_CHOICES.map((choice) => ({ label: HIDE_STARTED_LABELS[choice], value: choice })),
      },
      {
        type: 'toggle',
        messageKey: 'ALL_DAY_EVENTS',
        label: 'Show All-Day Events',
        description: 'Turn this off to leave out all-day events, such as reminders, birthdays, or a working from home status, so your next meeting comes first.',
        defaultValue: DEFAULTS.ALL_DAY_EVENTS,
      },
      // the built-in Calendar plugin reads whether the wearer is going from the phone but sends none of it
      { type: 'text', defaultValue: "The next three only reach events from your iCal feeds. The Pebble app doesn't share whether you're going to an event in your phone's calendars." },
      {
        type: 'toggle',
        messageKey: 'HIDE_DECLINED',
        label: 'Hide Declined Events',
        description: "Leaves out an invitation you've said no to. It needs the email addresses you're invited by.",
        defaultValue: DEFAULTS.HIDE_DECLINED,
      },
      {
        type: 'input',
        messageKey: 'EMAIL_ADDRESSES',
        label: 'Your Email Addresses',
        description: 'The addresses your invitations come to, separated by commas, so the plugin can find your own answer among the guests.',
        defaultValue: DEFAULTS.EMAIL_ADDRESSES,
        // a plain text box, so a list is never checked as one address, still with the email keyboard
        attributes: { type: 'text', inputmode: 'email', autocapitalize: 'off', autocorrect: 'off', placeholder: 'you@example.com' },
        visibleWhen: { key: 'HIDE_DECLINED', in: [true] },
      },
      {
        type: 'toggle',
        messageKey: 'HIDE_TENTATIVE',
        label: 'Hide Tentative Events',
        description: 'Leaves out an event marked tentative.',
        defaultValue: DEFAULTS.HIDE_TENTATIVE,
      },
      {
        type: 'toggle',
        messageKey: 'HIDE_FREE',
        label: 'Hide Free Events',
        description: 'Leaves out a timed event that shows you as free, such as a reminder or a hold. All-day events stay, since holiday calendars mark every holiday as free. Show All-Day Events covers those.',
        defaultValue: DEFAULTS.HIDE_FREE,
      },
      {
        type: 'input',
        messageKey: 'HIDE_TITLED',
        label: 'Hide Events Titled',
        description: 'Leaves out an event from any calendar whose title has one of these words, separated by commas, such as Lunch, Focus Time, Canceled:. A word matches from the start of a word in the title, whatever its case, so Lunch hides Team Lunch but not Brunch.',
        defaultValue: DEFAULTS.HIDE_TITLED,
        attributes: { type: 'text', autocapitalize: 'off', placeholder: 'Lunch, Focus Time' },
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
        description: "Puts the events from your iCal feeds on your watch's timeline, as the Pebble app does with your phone's calendars. The pins change only while a watchface or complication is showing your calendar, since that's when the plugin runs. The Pebble app asks you to allow Timeline.",
        defaultValue: DEFAULTS.TIMELINE_PINS,
      },
      {
        type: 'select',
        messageKey: 'PIN_REMINDER',
        label: 'Reminder',
        description: 'When a pinned event reminds you before it starts. All-day events get no reminder.',
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
        description: "How an event's start and end read on a watchface that shows them as text. Match the Pebble App reads 14:30 whatever the day, as the built-in Calendar plugin does. Short Labels follow the 12 or 24 hour clock picked in the Pebble app, and name the day for an event that isn't today, such as Thu or Nov 27. Most watchfaces show the time their own way and look the same with either.",
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
