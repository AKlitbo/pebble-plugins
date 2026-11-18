/**
 * The phone's events and both feeds' merged into one agenda.
 *
 * The agenda runs from today to the end of the Look Ahead, soonest first, cut at 20 events. An event
 * that shows up in two places shows once. Two feeds share an event when it has the same UID and the
 * same start. A feed event is the phone's own when it has the same title, ignoring case and the spaces
 * at its ends, the same start, and the same all-day flag, and the phone's copy is the one kept.
 *
 * The wearer's filters come before the cut, so a hidden event makes room for the next one rather than
 * leaving the agenda short. Hide Events in Progress takes a timed event under a day long off once it
 * has been going for the minutes picked. Show All-Day Events turned off drops all-day events from every
 * source.
 */

import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import { horizonFor, upcomingWindow } from '../../paf/ts/calendar/window';
import type { HorizonOptions } from '../../paf/ts/calendar/window';

/** The most events the agenda serves. */
export const MAX_EVENTS = 20;

/** Where an event came from: `phone`, `feed1`, or `feed2`. */
export type EventSource = 'phone' | 'feed1' | 'feed2';

/** One event on the agenda, with the id it goes out under. */
export interface AgendaEntry {
  instanceId: string;
  event: CalendarEvent;
}

/** Which events the wearer has asked the agenda to leave out. */
export interface AgendaFilters {
  /** The minutes after its start that a meeting leaves the agenda, or null to keep it until it ends. */
  hideStartedAfter: number | null;
  /** Whether all-day events stay on the agenda. */
  allDay: boolean;
}

/** A day in seconds, the shortest an event runs for Hide Events in Progress to leave it alone. */
const DAY_SECONDS = 24 * 60 * 60;

/**
 * The moment Hide Events in Progress takes an event off the agenda, or null when it never does.
 *
 * It only reaches a timed event that lasts under a day. Every all-day event starts at midnight and
 * would go the moment the day began. A timed event a day or longer, such as a hotel stay, is still
 * current for days after it starts. Both stay until they end.
 */
function cutoffOf(event: CalendarEvent, hideStartedAfter: number | null): number | null {
  if (hideStartedAfter === null || event.allDay || event.endEpoch - event.startEpoch >= DAY_SECONDS) {
    return null;
  }

  return event.startEpoch + hideStartedAfter * 60;
}

/** Whether an event gets past the wearer's filters at this moment. */
function passesFilters(event: CalendarEvent, nowSeconds: number, filters: AgendaFilters): boolean {
  if (event.allDay && !filters.allDay) {
    return false;
  }

  const cutoff = cutoffOf(event, filters.hideStartedAfter);

  // an event leaves on the second it reaches its cutoff, the same second nextChange gives for it
  return cutoff === null || nowSeconds < cutoff;
}

/**
 * The next moment the agenda changes on its own, when one of its events ends or Hide Events in
 * Progress takes one off.
 *
 * @param agenda The agenda as mergeAgenda gave it.
 * @param hideStartedAfter The minutes after its start that a meeting leaves, or null for never.
 * @return The soonest moment one of its events leaves, as epoch seconds, or null for an empty agenda.
 */
export function nextChange(agenda: AgendaEntry[], hideStartedAfter: number | null): number | null {
  const moments = agenda.map(({ event }) => {
    // the window keeps an event through its last second, so it leaves the second after
    const ends = event.endEpoch + 1;
    const cutoff = cutoffOf(event, hideStartedAfter);

    return cutoff === null ? ends : Math.min(ends, cutoff);
  });

  return moments.length > 0 ? Math.min(...moments) : null;
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
 * @param lookAhead How many days the agenda holds, the week when left out, and the phone's offset
 *   reader, which only a spec that stands the phone in another zone passes.
 * @param filters Which events the wearer has asked to leave out, none when left out.
 * @return The agenda, soonest first, at most `MAX_EVENTS` long.
 */
export function mergeAgenda(phone: CalendarEvent[], feeds: Array<{ source: EventSource; events: CalendarEvent[] }>, nowSeconds: number, lookAhead: HorizonOptions = {}, filters: AgendaFilters = { hideStartedAfter: null, allDay: true }): AgendaEntry[] {
  const sources = new Map<CalendarEvent, EventSource>(phone.map((event) => [event, 'phone']));

  for (const feed of feeds) {
    for (const event of feed.events) {
      const duplicate = [...sources].some(([kept, keptFrom]) => sameEvent(kept, keptFrom, event));

      if (!duplicate) {
        sources.set(event, feed.source);
      }
    }
  }

  const agenda = upcomingWindow([...sources.keys()], nowSeconds, horizonFor(nowSeconds, lookAhead))
    .filter((event) => passesFilters(event, nowSeconds, filters))
    .slice(0, MAX_EVENTS);
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
