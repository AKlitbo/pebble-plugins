/**
 * The phone's calendars, read through the Pebble app's built-in Calendar plugin.
 *
 * A plugin's script cannot read the phone's calendars itself, but it can read another plugin's source.
 * Naming the built-in by its uuid reaches it even while Calendar Enhanced + iCal is the wearer's
 * preferred calendar, since the Pebble app never routes a plugin's read back to itself. The built-in
 * serves the calendars switched on in the Pebble app's own settings, over 7 days. It stops at 10
 * events unless the read asks for more, so the read asks for the most the Pebble app gives and the
 * agenda's own window and filters cut from there. It asks for each event's notes too, which the
 * built-in only sends to a read that names them.
 */

import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import type { PhoneOffset } from '../../paf/ts/pkjs/phone-clock';
import { failureReason } from '../../paf/ts/plugin-app/runtime';
import type { PluginPebble, SourceRequest } from '../../paf/ts/plugin-app/runtime';
import { SOURCE_LIMIT_MAX } from '../../paf/ts/plugin-app/source-limit';
import { CALENDAR_PROPERTIES, CALENDAR_PROPERTIES_WITH_DESCRIPTION, eventsFromUpdate } from '../../paf/ts/plugin-sources/calendar';

/** The Pebble app's built-in Calendar plugin. */
export const BUILT_IN_CALENDAR = '00000000-0000-0000-0001-000000000004';

const BUILT_IN_EVENTS: SourceRequest = { category: 'calendar', item: 'event', plugin: BUILT_IN_CALENDAR, properties: CALENDAR_PROPERTIES_WITH_DESCRIPTION, limit: SOURCE_LIMIT_MAX };

/** The part of `localStorage` the phone's last good read is kept in, which a spec stands in for. */
export type PhoneStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Where the phone's last good read is kept in `localStorage`, or the marker a refusal leaves there. */
export const PHONE_COPY_KEY = 'calendar-ical-phone';

/**
 * How long the last good read can stand in for a read that fails. A read is only kept to ride out a
 * slow phone, and past this an event changed on the phone since would show as it was for too long.
 */
export const PHONE_COPY_MS = 3 * 60 * 60 * 1000;

/**
 * The reasons a read fails that mean the wearer said no, such as turning Calendar off. The rest, such
 * as a read that times out, say nothing about the calendars.
 */
const REFUSALS = ['PERMISSION_DENIED'];

/**
 * What is kept under `PHONE_COPY_KEY`: the last good read with the start of the run that made it, or
 * the marker a refusal leaves with the start of the run that was refused.
 */
type PhoneCopy = { readMs: number; events: CalendarEvent[] } | { refusedMs: number };

/** What is kept, or null for nothing or something that reads back as neither a read nor a marker. */
function readPhoneCopy(storage: PhoneStorage): PhoneCopy | null {
  try {
    const copy = JSON.parse(storage.getItem(PHONE_COPY_KEY) || 'null');

    if (copy && typeof copy.readMs === 'number' && Array.isArray(copy.events)) {
      return copy;
    }

    return copy && typeof copy.refusedMs === 'number' ? copy : null;
  } catch {
    return null;
  }
}

/**
 * Keeps a read or a marker, unless what is kept already came from a run that started later. Runs can
 * overlap, and a slow read finishing after a newer run must neither replace that run's read nor bring
 * back events the wearer has since refused.
 */
function writePhoneCopy(storage: PhoneStorage, copy: PhoneCopy, runMs: number): void {
  const kept = readPhoneCopy(storage);
  const keptMs = kept === null ? -Infinity : 'readMs' in kept ? kept.readMs : kept.refusedMs;

  if (keptMs > runMs) {
    return;
  }

  try {
    storage.setItem(PHONE_COPY_KEY, JSON.stringify(copy));
  } catch (error) {
    console.log(`Calendar Enhanced + iCal: the phone's calendars could not be kept, ${error}`);
  }
}

/**
 * Leaves the refusal marker in place of the phone's last good read, for when the wearer turns Show
 * Phone Calendars off, so a run after they turn it back on never serves events from before.
 *
 * @param storage Where the read is kept, normally `localStorage`.
 * @param runMs When the run that saw the refusal started.
 */
export function refusePhoneCopy(storage: PhoneStorage, runMs: number): void {
  writePhoneCopy(storage, { refusedMs: runMs }, runMs);
}

// the names ask reads only what places an event in the week and names its calendar, with no titles,
// places, or notes, and still as many events as a read can give, so no calendar in the week is missed
const NAMES_REQUEST: SourceRequest = {
  ...BUILT_IN_EVENTS,
  properties: CALENDAR_PROPERTIES.filter((property) => property !== 'name' && property !== 'location'),
};

/**
 * The names of the phone's calendars that have events in the built-in's week, sorted, for the settings
 * page's list, or the reason there are none to give.
 *
 * It reads the built-in without subscribing and keeps nothing, so the page's ask never changes what a
 * run serves. A read the wearer refused, such as `PERMISSION_DENIED`, answers no names and the reason,
 * kept read or not, so the page can say Calendar is not allowed rather than that the week is empty.
 * Any other failed read takes the names from the kept read, whatever its age, since a name goes stale
 * far more slowly than an event, and nothing kept gives none.
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param nowMs The time now.
 * @param storage Where the last good read is kept, normally `localStorage`.
 * @return The distinct names the events carry, sorted, and the reason for a refused read.
 */
export async function phoneCalendarNames(pebble: PluginPebble, nowMs: number, storage: PhoneStorage): Promise<{ calendars: string[]; error?: string }> {
  let events: CalendarEvent[];

  try {
    events = eventsFromUpdate(await pebble.readSource(NAMES_REQUEST), Math.floor(nowMs / 1000));
  } catch (error) {
    const reason = failureReason(error);

    if (REFUSALS.includes(reason)) {
      return { calendars: [], error: reason };
    }

    const kept = readPhoneCopy(storage);

    events = kept && 'readMs' in kept ? kept.events : [];
  }

  const names = new Set<string>();

  events.forEach((event) => {
    if (typeof event.calendar === 'string' && event.calendar) {
      names.add(event.calendar);
    }
  });

  return { calendars: [...names].sort((first, second) => first.localeCompare(second)) };
}

/**
 * The phone's events, read from the built-in in the run that asks.
 *
 * The subscription is what has the Pebble app run Calendar Enhanced + iCal again when the phone's
 * calendars change. The read waits for the built-in's latest update, and a good one is kept. A read
 * that fails for any other reason than the wearer's refusal, such as one that times out, serves the
 * kept read in its place for up to `PHONE_COPY_MS`, which the agenda's window and filters then cut as
 * they cut a new one, so a slow phone does not empty the agenda. A kept read that looks younger than
 * nothing, from a clock set back, is not served. A refusal leaves the refusal marker in place of the
 * kept read and the phone's part empty, so turning Calendar off takes the phone's events away. The
 * feeds serve either way.
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param nowMs The start of the run, the time now.
 * @param storage Where the last good read is kept, normally `localStorage`.
 * @param offsetAt Reads the phone's offset, passed only by a spec that stands the phone in another zone.
 * @return The phone's events in the agenda's window, the kept read's when the read fails, and none
 *   when the wearer refused it or nothing young enough is kept.
 */
export async function phoneEvents(pebble: PluginPebble, nowMs: number, storage: PhoneStorage, offsetAt?: PhoneOffset): Promise<CalendarEvent[]> {
  let events: CalendarEvent[];

  try {
    pebble.subscribeSource(BUILT_IN_EVENTS);
    events = eventsFromUpdate(await pebble.readSource(BUILT_IN_EVENTS), Math.floor(nowMs / 1000), offsetAt);
  } catch (error) {
    const reason = failureReason(error);

    console.log(`Calendar Enhanced + iCal: the phone's calendars could not be read, ${reason}`);

    if (REFUSALS.includes(reason)) {
      writePhoneCopy(storage, { refusedMs: nowMs }, nowMs);
      return [];
    }

    const kept = readPhoneCopy(storage);

    if (!kept || !('readMs' in kept)) {
      return [];
    }

    const age = nowMs - kept.readMs;

    return age >= 0 && age <= PHONE_COPY_MS ? kept.events : [];
  }

  writePhoneCopy(storage, { readMs: nowMs, events }, nowMs);

  return events;
}
