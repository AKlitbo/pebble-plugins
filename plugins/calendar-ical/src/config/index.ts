/**
 * Calendar Enhanced + iCal's settings page. The framework builds it into the pbw's config.html,
 * loads the saved settings from the plugin when it opens, and hands them back on Save.
 */

import type { ClayConfigItem } from '../../paf/ts/clay/types';
import { CALLOUT_BADGE, CALLOUT_BOX } from '../../paf/ts/clay/callout-style';
import { DEFAULTS, HIDE_STARTED_CHOICES, LOOK_AHEAD_DAYS, REFRESH_MINUTES } from '../settings';

/** How the Look Ahead select names each of its day counts. */
const LOOK_AHEAD_LABELS: Record<string, string> = { 1: 'Today', 3: '3 Days', 7: '1 Week', 14: '2 Weeks', 31: '1 Month' };

/** How the Hide Events in Progress select names each of its choices. */
const HIDE_STARTED_LABELS: Record<string, string> = { never: 'Never', 0: 'When They Start', 15: '15 Minutes After', 30: '30 Minutes After', 60: '60 Minutes After' };

/** One iCal feed's section, with its name and link shown only while the feed is on. */
function feedSection(slot: 1 | 2): ClayConfigItem {
  const on = `FEED${slot}_ON` as const;
  const name = `FEED${slot}_NAME` as const;
  const url = `FEED${slot}_URL` as const;
  const shown = { key: on, in: [true] };

  return {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: `iCal Feed ${slot}` },
      { type: 'toggle', messageKey: on, label: `Show iCal Feed ${slot}`, defaultValue: DEFAULTS[on] },
      { type: 'input', messageKey: name, label: 'Name', defaultValue: DEFAULTS[name], visibleWhen: shown },
      { type: 'input', messageKey: url, label: 'iCal Link', defaultValue: DEFAULTS[url], attributes: { type: 'url', placeholder: 'https://' }, visibleWhen: shown },
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
      { type: 'text', defaultValue: "Pick which of the phone's calendars show in the built-in Calendar plugin's settings in the Pebble app.", visibleWhen: { key: 'PHONE_CALENDARS', in: [true] } },
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
    ],
  },
  { type: 'submit', defaultValue: 'Save' },
];
