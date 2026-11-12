/**
 * The calendar face's own key, and the agenda unpacked for the log.
 *
 * The agenda the framework sends the watch carries each event's times, title, and place, but not the
 * calendar it is from. The framework also sorts and trims the plugin's events before it packs them, so
 * the face cannot tell from the update alone which event lands in which slot. So it unpacks each agenda
 * on its way out, finds each event back in the plugin's update, and sends the calendars' names slot by
 * slot in the report.
 *
 * The framework's own eventsFromUpdate would give the slot order straight from the update, but it lives
 * in plugin-sources/calendar.ts, and the build refuses a face that imports past the plugin-sources
 * index. Reading the agenda that really went out also keeps the names on the slots the watch holds.
 */

import wire, { WIRE_CAPS } from '../../paf/ts/pkjs/wire';
import { instancesOf, propertiesOf, text, timestamp } from '../../paf/ts/plugin-shapes/shapes';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';

/** How long a calendar's name the watch holds, one short of its 24 byte buffer. */
const CALENDAR_NAME_MAX = 23;

/** The title the framework gives an event the plugin sent with none. */
const NO_TITLE = '(no title)';

/**
 * How far an event's start can move between the plugin and the agenda. The framework rounds an
 * all-day event to the phone's nearest midnight, which is at most 14 hours off in any zone.
 */
const START_SLACK_SECONDS = 14 * 60 * 60;

/** One event of an agenda, as the watch will read it. */
export interface AgendaEvent {
  start: number;
  end: number;
  allDay: boolean;
  title: string;
  location: string;
}

/** One event of the plugin's update, as the agenda would write it. */
interface Candidate {
  title: string;
  start: number | undefined;
  calendar: string;
  used: boolean;
}

/** Reads a little endian number of four bytes, signed. */
function int32At(bytes: ArrayLike<number>, at: number): number {
  const value = (bytes[at] & 0xff) + (bytes[at + 1] & 0xff) * 0x100 + (bytes[at + 2] & 0xff) * 0x10000 + (bytes[at + 3] & 0xff) * 0x1000000;

  return value >= 0x80000000 ? value - 0x100000000 : value;
}

/** Reads a length byte and the text after it, or null when the bytes run out first. */
function textAt(bytes: ArrayLike<number>, at: number): { text: string; next: number } | null {
  if (at >= bytes.length || at + 1 + bytes[at] > bytes.length) {
    return null;
  }

  let out = '';

  for (let index = 0; index < bytes[at]; index++) {
    out += String.fromCharCode(bytes[at + 1 + index]);
  }

  return { text: out, next: at + 1 + bytes[at] };
}

/**
 * Unpacks a packed agenda: a count, then each event as its start and end as four bytes each, a flags
 * byte whose lowest bit is all day, and then the title and the place, each after a length byte.
 *
 * @param bytes The agenda as the phone hands it to the watch.
 * @return The events, or null when the bytes run out before the count says they should.
 */
export function decodeAgenda(bytes: ArrayLike<number>): AgendaEvent[] | null {
  if (bytes.length < 1) {
    return null;
  }

  const events: AgendaEvent[] = [];
  let at = 1;

  for (let index = 0; index < bytes[0]; index++) {
    if (at + 9 > bytes.length) {
      return null;
    }

    const title = textAt(bytes, at + 9);
    const location = title ? textAt(bytes, title.next) : null;

    if (!title || !location) {
      return null;
    }

    events.push({ start: int32At(bytes, at), end: int32At(bytes, at + 4), allDay: (bytes[at + 8] & 1) === 1, title: title.text, location: location.text });
    at = location.next;
  }

  return events;
}

/**
 * Finds each agenda event back in the plugin's update and names its calendar.
 *
 * An event matches an instance with the same title, as the agenda writes it, and the nearest start
 * within the slack an all-day event's rounding allows. Each instance names one event at most, so two
 * events with the same title and start still take one calendar each.
 *
 * @param events The agenda's events, in slot order.
 * @param envelope The plugin's last update.
 * @return Each event's calendar in ASCII, or empty for one with none or no match.
 */
export function calendarNames(events: AgendaEvent[], envelope: SourceEnvelope | null): string[] {
  const candidates: Candidate[] = instancesOf(envelope).map((instance) => {
    const properties = propertiesOf(instance) || {};

    return {
      title: wire.toAscii(text(properties.name, 'long') ?? NO_TITLE, WIRE_CAPS.CALENDAR_TITLE_MAX),
      start: timestamp(properties.starts_at),
      calendar: text(properties.calendar, 'long') || '',
      used: false,
    };
  });

  return events.map((event) => {
    let best: Candidate | null = null;
    let bestGap = Infinity;

    for (const candidate of candidates) {
      const gap = candidate.start === undefined ? Infinity : Math.abs(candidate.start - event.start);

      if (!candidate.used && candidate.title === event.title && gap <= START_SLACK_SECONDS && gap < bestGap) {
        best = candidate;
        bestGap = gap;
      }
    }

    if (!best) {
      return '';
    }

    best.used = true;

    return wire.toAscii(best.calendar, CALENDAR_NAME_MAX);
  });
}

/** What the calendar face hands the plugin watch, to keep the calendars' names in step with the agenda. */
export interface AgendaNames {
  /** Keeps the events of an agenda on its way to the watch, and says whether it was one. */
  noticeSend(dict: AppMessageDict, messageKeys: Record<string, number>): boolean;
  /** The calendars' names for the report, one per line in slot order, or nothing before an agenda has gone. */
  extras(latest: SourceEnvelope | null, messageKeys: Record<string, number>): AppMessageDict;
}

/**
 * Keeps the calendars' names in step with the agenda the watch holds.
 *
 * The framework drops an agenda that matches the one the watch took last, so a renamed calendar alone
 * never sends one. So the names go in the report rather than beside the agenda. The report works them
 * out afresh from the last agenda that went out and the plugin's last update whenever either changes,
 * and goes again only when the names come out different.
 *
 * @return The two hooks the plugin watch takes.
 */
export function createAgendaNames(): AgendaNames {
  let events: AgendaEvent[] | null = null;

  return {
    noticeSend(dict, messageKeys) {
      const strip = dict[messageKeys.CALENDAR_STRIP];
      const decoded = Array.isArray(strip) ? decodeAgenda(strip) : null;

      if (!decoded) {
        return false;
      }

      events = decoded;
      return true;
    },
    extras(latest, messageKeys) {
      return events ? { [messageKeys.TEST_CALENDARS]: calendarNames(events, latest).join('\n') } : {};
    },
  };
}

/** Writes a moment as an ISO time. */
function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * Writes an agenda on its way to the watch, one line per event, and the calendars' names as a list.
 *
 * @param name The key's name.
 * @param value The key's value.
 * @return The lines for the log, or undefined for any key but those two.
 */
export function describeAgenda(name: string, value: number | string | number[]): string[] | undefined {
  if (name === 'TEST_CALENDARS' && typeof value === 'string') {
    return [`TEST_CALENDARS ${JSON.stringify(value.split('\n'))}`];
  }

  if (name !== 'CALENDAR_STRIP' || !Array.isArray(value)) {
    return undefined;
  }

  const events = decodeAgenda(value);

  if (!events) {
    return [`CALENDAR_STRIP ${value.length} bytes that do not unpack`];
  }

  return [`CALENDAR_STRIP ${events.length} events`].concat(
    events.map((event, index) => `  event ${index}: ${iso(event.start)} to ${iso(event.end)}${event.allDay ? ' all day' : ''} ${JSON.stringify(event.title)} at ${JSON.stringify(event.location)}`)
  );
}
