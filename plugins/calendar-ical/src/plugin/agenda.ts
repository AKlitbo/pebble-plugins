/**
 * The phone's events and both feeds' merged into one agenda.
 *
 * The agenda is today plus the next six days, soonest first, cut at 20 events. An event that shows up
 * in two places shows once. Two feeds share an event when it has the same UID and the same start. A
 * feed event is the phone's own when it has the same title, ignoring case and the spaces at its ends,
 * the same start, and the same all-day flag, and the phone's copy is the one kept.
 */

import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import { horizonFor, upcomingWindow } from '../../paf/ts/calendar/window';
import type { PhoneOffset } from '../../paf/ts/pkjs/phone-clock';

/** The most events the agenda serves. */
export const MAX_EVENTS = 20;

/** Where an event came from: `phone`, `feed1`, or `feed2`. */
export type EventSource = 'phone' | 'feed1' | 'feed2';

/** One event on the agenda, with the id it goes out under. */
export interface AgendaEntry {
  instanceId: string;
  event: CalendarEvent;
}

/** A title as the duplicate check compares it. */
function titleKey(title: string): string {
  return title.trim().toLowerCase();
}

/** Whether an event already on the list is the same event as a feed's. */
function sameEvent(kept: CalendarEvent, keptFrom: EventSource, event: CalendarEvent): boolean {
  if (kept.startEpoch !== event.startEpoch) {
    return false;
  }

  // the built-in sends no UID, so a phone event can only be matched on what the wearer sees
  if (keptFrom === 'phone') {
    return kept.allDay === event.allDay && titleKey(kept.title) === titleKey(event.title);
  }

  return Boolean(event.uid) && kept.uid === event.uid;
}

/**
 * The id an event goes out under, the same from run to run while the event is.
 *
 * The built-in's own ids are only an event's place in its list, so every event goes by its start and
 * its title, whichever source it came from. An event the phone and a feed share then keeps its id on a
 * run where the phone could not be read and the feed's copy goes out in its place.
 */
function instanceIdOf(event: CalendarEvent): string {
  return `${event.startEpoch}:${titleKey(event.title)}`;
}

/**
 * Merges the phone's events and the feeds' into the agenda.
 *
 * @param phone The phone's events.
 * @param feeds Each feed's events, in the order they are checked against what is already kept.
 * @param nowSeconds The time now, as epoch seconds.
 * @param offsetAt Reads the phone's offset, passed only by a spec that stands the phone in another zone.
 * @return The agenda, soonest first, at most `MAX_EVENTS` long.
 */
export function mergeAgenda(phone: CalendarEvent[], feeds: Array<{ source: EventSource; events: CalendarEvent[] }>, nowSeconds: number, offsetAt?: PhoneOffset): AgendaEntry[] {
  const sources = new Map<CalendarEvent, EventSource>(phone.map((event) => [event, 'phone']));

  for (const feed of feeds) {
    for (const event of feed.events) {
      const duplicate = [...sources].some(([kept, keptFrom]) => sameEvent(kept, keptFrom, event));

      if (!duplicate) {
        sources.set(event, feed.source);
      }
    }
  }

  const agenda = upcomingWindow([...sources.keys()], nowSeconds, horizonFor(nowSeconds, offsetAt)).slice(0, MAX_EVENTS);
  const taken = new Set<string>();

  return agenda.map((event) => {
    const base = instanceIdOf(event);
    let instanceId = base;

    // two calendars can hold the same meeting at once, and each copy still needs an id of its own
    for (let copy = 2; taken.has(instanceId); copy++) {
      instanceId = `${base}#${copy}`;
    }

    taken.add(instanceId);

    return { instanceId, event };
  });
}
