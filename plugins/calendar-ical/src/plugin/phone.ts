/**
 * The phone's calendars, read through the Pebble app's built-in Calendar plugin.
 *
 * A plugin's script cannot read the phone's calendars itself, but it can read another plugin's source.
 * Naming the built-in by its uuid reaches it even while Calendar + iCal is the wearer's preferred
 * calendar, since the Pebble app never routes a plugin's read back to itself. The built-in serves the
 * calendars switched on in the Pebble app's own settings, at most 10 events over 7 days.
 */

import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import type { PhoneOffset } from '../../paf/ts/pkjs/phone-clock';
import type { PluginPebble, SourceRequest } from '../../paf/ts/plugin-app/runtime';
import { CALENDAR_PROPERTIES, eventsFromUpdate } from '../../paf/ts/plugin-sources/calendar';

/** The Pebble app's built-in Calendar plugin. */
export const BUILT_IN_CALENDAR = '00000000-0000-0000-0001-000000000004';

const BUILT_IN_EVENTS: SourceRequest = { category: 'calendar', item: 'event', plugin: BUILT_IN_CALENDAR, properties: CALENDAR_PROPERTIES };

/** What the runtime gave as the reason a read failed, such as `PERMISSION_DENIED`. */
function reason(error: unknown): string {
  const failure = error as { code?: unknown; message?: unknown } | null;

  return String((failure && (failure.code || failure.message)) || error);
}

/**
 * The phone's events, read from the built-in in the run that asks.
 *
 * The subscription is what has the Pebble app run Calendar + iCal again when the phone's calendars
 * change. The read waits for the built-in's latest update. A read the Pebble app refuses, such as
 * one the wearer has not allowed or one that times out, leaves the phone's part empty and the feeds
 * serve on their own.
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param nowSeconds The time now, as epoch seconds.
 * @param offsetAt Reads the phone's offset, passed only by a spec that stands the phone in another zone.
 * @return The phone's events in the agenda's window, or none when the read fails.
 */
export async function phoneEvents(pebble: PluginPebble, nowSeconds: number, offsetAt?: PhoneOffset): Promise<CalendarEvent[]> {
  try {
    pebble.subscribeSource(BUILT_IN_EVENTS);

    return eventsFromUpdate(await pebble.readSource(BUILT_IN_EVENTS), nowSeconds, offsetAt);
  } catch (error) {
    console.log(`Calendar + iCal: the phone's calendars could not be read, ${reason(error)}`);
    return [];
  }
}
