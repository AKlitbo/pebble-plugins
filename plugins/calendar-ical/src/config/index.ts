/**
 * Calendar + iCal's settings page. The framework builds it into the pbw's config.html, loads the
 * saved settings from the plugin when it opens, and hands them back on Save.
 */

import type { ClayConfigItem } from '../../paf/ts/clay/types';
import { DEFAULTS, REFRESH_MINUTES } from '../settings';

/** One iCal feed's section, with its name and link shown only while the feed is on. */
function feedSection(slot: 1 | 2): ClayConfigItem {
  const on = `FEED${slot}_ON` as const;
  const name = `FEED${slot}_NAME` as const;
  const url = `FEED${slot}_URL` as const;
  const shown = { key: on, in: [true] };

  return {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: `Feed ${slot}` },
      { type: 'toggle', messageKey: on, label: `Show Feed ${slot}`, defaultValue: DEFAULTS[on] },
      { type: 'input', messageKey: name, label: 'Name', defaultValue: DEFAULTS[name], visibleWhen: shown },
      { type: 'input', messageKey: url, label: 'iCal Link', defaultValue: DEFAULTS[url], attributes: { type: 'url', placeholder: 'https://' }, visibleWhen: shown },
    ],
  };
}

export const clayConfig: ClayConfigItem[] = [
  { type: 'heading', defaultValue: 'Calendar + iCal' },
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
      {
        type: 'select',
        messageKey: 'REFRESH',
        label: 'Refresh Interval',
        defaultValue: DEFAULTS.REFRESH,
        options: REFRESH_MINUTES.map((minutes) => ({ label: minutes === '60' ? '1 Hour' : `${minutes} Minutes`, value: minutes })),
      },
    ],
  },
  { type: 'submit', defaultValue: 'Save' },
];
