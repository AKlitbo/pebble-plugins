/**
 * The phone's events and both feeds' merged into one agenda.
 *
 * The agenda runs from today to the end of the Look Ahead, soonest first, cut at the most events the
 * reader asked for, or 20 when it asked for no number. An event
 * that shows up in two places shows once. Two feeds share an event when it has the same UID and the
 * same start. A feed event is the phone's own when it has the same title, ignoring case and the spaces
 * at its ends, the same start, and the same all-day flag, and the phone's copy is the one kept.
 *
 * The wearer's filters come before the cut, so a hidden event makes room for the next one rather than
 * leaving the agenda short. Hide Events in Progress takes a timed event under a day long off once it
 * has been going for the minutes picked. Show All-Day Events turned off drops all-day events from every
 * source. Hide Declined Events, Hide Tentative Events, and Hide Free Events drop the events a feed marks
 * that way. The phone's events carry no marks, since the built-in sends none, so a phone event a feed
 * also holds takes the feed's marks. Hide Free Events leaves all-day events alone, since holiday feeds
 * mark every holiday free. Hide Events Titled drops an event from any source whose title matches one of
 * the wearer's keywords.
 */

import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import { horizonFor, upcomingWindow } from '../../paf/ts/calendar/window';
import type { HorizonOptions } from '../../paf/ts/calendar/window';
import { matchesKeyword } from '../../paf/ts/calendar/keywords';
import { fingerprint } from '../../paf/ts/pkjs/fingerprint';

/** The most events the agenda serves a reader that asks for no number. */
export const MAX_EVENTS = 20;

/** Where an event came from: `phone`, `feed1`, or `feed2`. */
export type EventSource = 'phone' | 'feed1' | 'feed2';

/** One event on the agenda, with the id it goes out under and every source that holds it. */
export interface AgendaEntry {
  instanceId: string;
  event: CalendarEvent;
  /** Where the kept copy came from first, then each source that held the same event, in the order checked. */
  sources: EventSource[];
}

/** Which events the wearer has asked the agenda to leave out. */
export interface AgendaFilters {
  /** The minutes after its start that a meeting leaves the agenda, or null to keep it until it ends. */
  hideStartedAfter: number | null;
  /** Whether all-day events stay on the agenda. */
  allDay: boolean;
  /** Whether events the wearer declined leave the agenda. */
  hideDeclined?: boolean;
  /** Whether events marked tentative leave the agenda. */
  hideTentative?: boolean;
  /** Whether timed events marked free leave the agenda. */
  hideFree?: boolean;
  /** The keywords whose titles leave the agenda, as `parseKeywords` gives them. None when left out. */
  hideTitled?: readonly string[];
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

  if ((filters.hideDeclined && event.declined) || (filters.hideTentative && event.tentative) || (filters.hideFree && event.free && !event.allDay)) {
    return false;
  }

  if (filters.hideTitled && filters.hideTitled.length > 0 && matchesKeyword(event.title, filters.hideTitled)) {
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
 * run where the phone could not be read and the feed's copy goes out in its place. The title goes in
 * as a fingerprint, so the id carries nothing of the title itself.
 */
function instanceIdOf(event: CalendarEvent): string {
  return `${event.startEpoch}:${fingerprint(titleKey(event.title))}`;
}

/**
 * An event kept with the marks of a copy found to be the same event. The phone sends no marks, so a
 * feed's declined, tentative, or free reaches the phone's copy this way. It is a new event rather than
 * the kept one changed, so the marks never land in the phone's kept read.
 */
function withMarks(kept: CalendarEvent, event: CalendarEvent): CalendarEvent {
  if (!event.declined && !event.tentative && !event.free) {
    return kept;
  }

  const marked = { ...kept };

  if (event.declined) {
    marked.declined = true;
  }

  if (event.tentative) {
    marked.tentative = true;
  }

  if (event.free) {
    marked.free = true;
  }

  return marked;
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
 * @param limit The most events the agenda holds, `MAX_EVENTS` when left out.
 * @return The agenda, soonest first, at most `limit` long.
 */
export function mergeAgenda(phone: CalendarEvent[], feeds: Array<{ source: EventSource; events: CalendarEvent[] }>, nowSeconds: number, lookAhead: HorizonOptions = {}, filters: AgendaFilters = { hideStartedAfter: null, allDay: true }, limit = MAX_EVENTS): AgendaEntry[] {
  const kept: Array<{ event: CalendarEvent; sources: EventSource[] }> = phone.map((event) => ({ event, sources: ['phone'] }));

  for (const feed of feeds) {
    for (const event of feed.events) {
      const same = kept.find((entry) => sameEvent(entry.event, entry.sources[0], event));

      if (!same) {
        kept.push({ event, sources: [feed.source] });
      } else {
        same.event = withMarks(same.event, event);

        if (!same.sources.includes(feed.source)) {
          same.sources.push(feed.source);
        }
      }
    }
  }

  const sourcesOf = new Map(kept.map((entry) => [entry.event, entry.sources]));
  const agenda = upcomingWindow([...sourcesOf.keys()], nowSeconds, horizonFor(nowSeconds, lookAhead))
    .filter((event) => passesFilters(event, nowSeconds, filters))
    .slice(0, limit);
  const taken = new Set<string>();

  return agenda.map((event) => {
    const base = instanceIdOf(event);
    let instanceId = base;

    // two calendars can hold the same meeting at once, and each copy still needs an id of its own
    for (let copy = 2; taken.has(instanceId); copy++) {
      instanceId = `${base}#${copy}`;
    }

    taken.add(instanceId);

    return { instanceId, event, sources: sourcesOf.get(event) as EventSource[] };
  });
}
