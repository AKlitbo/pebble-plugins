/**
 * Calendar Enhanced + iCal's timeline pins for the events from its iCal feeds.
 *
 * The Pebble app already pins the phone's own events, so only a feed event the agenda keeps, after
 * every filter, gets a pin, and never one a phone event also holds. Each run works out the pins the
 * agenda wants and brings the timeline in line: a new event is inserted, a changed one inserted again
 * under its id, and one the agenda no longer has, because it moved, went, or a filter took it off, is
 * deleted. An event that has simply ended keeps its pin, so the timeline's past still shows it, and
 * the record lets it go. Turning Pin iCal Events to the Timeline off deletes them all. The plugin only runs while
 * something reads `calendar/event`, so the pins only change then too.
 *
 * What is pinned sits in `localStorage` by the event's instance id, with the pin's id and a fingerprint
 * of what it held, so an unchanged pin is never sent again. The Pebble app never says whether a pin
 * call worked: it drops a pin it cannot place, or a delete of an id it does not have, without a word.
 * So the record is what the plugin asked for, not what the timeline holds, and a delete is safe to
 * repeat. While the permission query says Timeline is denied, nothing is inserted, so every pin goes
 * in once the wearer allows it, and the deletes still go out, so pins already there can come off. A
 * Timeline not asked about yet is pinned as normal, since the Pebble app asks the wearer on its first
 * use. Every call is made before the run answers,
 * since the Pebble app ends the plugin's session once it has its answer. A pin's id stays the same
 * while its event does. The pin guide says a deleted id cannot be used again, and the guide for pins from the phone
 * does not say either way, so a deleted id is kept aside until its event is long past, and an event
 * that comes back gets an id with a count after it.
 */

import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import { fingerprint } from '../../paf/ts/pkjs/fingerprint';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { deletePin, insertPin } from '../../paf/ts/plugin-app/timeline';
import type { PinAction, PinLayout, TimelinePin } from '../../paf/ts/plugin-app/timeline';
import type { AgendaEntry } from './agenda';

/** The part of `localStorage` the pins use, which a spec stands in for. */
export type PinStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Where what is pinned is kept in `localStorage`. */
export const PINS_KEY = 'calendar-ical-pins';

/**
 * The most pins kept at once, the soonest first. Every pin goes through the Pebble app to the watch's
 * own storage, and a month of a busy feed would otherwise send hundreds the wearer never scrolls to.
 */
export const PIN_CAP = 50;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// the pin guide holds a pin's time to two days back and a year ahead
const PAST_MS = 2 * DAY_MS;
const AHEAD_MS = 365 * DAY_MS;

// the icon the Pebble app's own calendar pins use
const CALENDAR_ICON = 'system://images/TIMELINE_CALENDAR';

/** What a run hands the pins. */
export interface PinOptions {
  /** Whether Pin iCal Events to the Timeline is on. */
  on: boolean;
  /** The minutes before a timed event's start its reminder shows, or null for none. */
  reminderMinutes: number | null;
  /** The time now. */
  nowMs: number;
  /** The actions each pin carries, from its event's instance id. None when left out. */
  actionsFor?: (instanceId: string) => PinAction[];
}

/** One pin as kept, by its event's instance id. */
interface KeptPin {
  id: string;
  /** When its event ends. */
  endMs: number;
  /** A fingerprint of what the pin held, so an unchanged pin is not sent again. */
  held: string;
}

/** Everything kept about the pins. */
interface PinRecord {
  pinned: Record<string, KeptPin>;
  /** Each id deleted, with when it can be forgotten, once its event's start is past the timeline's reach. */
  retired: Record<string, number>;
}

/** What is kept, or an empty record for nothing or something that does not read back as a record. */
function readRecord(storage: PinStorage): PinRecord {
  try {
    const record = JSON.parse(storage.getItem(PINS_KEY) || 'null');

    if (record && typeof record.pinned === 'object' && record.pinned && typeof record.retired === 'object' && record.retired) {
      return record;
    }
  } catch {
    // an unreadable record reads as nothing pinned
  }

  return { pinned: {}, retired: {} };
}

/** Keeps the record, logging rather than failing the run when storage refuses it. */
function writeRecord(storage: PinStorage, record: PinRecord): void {
  try {
    storage.setItem(PINS_KEY, JSON.stringify(record));
  } catch (error) {
    console.log(`Calendar Enhanced + iCal: the pins could not be kept, ${error}`);
  }
}

/** The start in milliseconds that an instance id begins with, or 0 when it has none. */
function startOf(instanceId: string): number {
  return (Number(instanceId.split(':')[0]) || 0) * 1000;
}

/**
 * The id a new pin goes in under: the instance id with a prefix, and a count after it when that id
 * was deleted before. An instance id is a start in seconds and a short fingerprint, so this stays well
 * inside the pin guide's 64 characters.
 */
function freshId(instanceId: string, retired: Record<string, number>): string {
  const base = `cei-${instanceId}`;
  let id = base;

  for (let count = 2; Object.prototype.hasOwnProperty.call(retired, id); count++) {
    id = `${base}~${count}`;
  }

  return id;
}

/** Whether an event's pin falls inside the timeline's reach, two days back to a year ahead. */
function inReach(event: CalendarEvent, nowMs: number): boolean {
  const startMs = event.startEpoch * 1000;

  return startMs >= nowMs - PAST_MS && startMs <= nowMs + AHEAD_MS;
}

/**
 * The pin for one event. A timed event gets a reminder its lead before it starts, while that is still
 * ahead. An all-day event is pinned at the phone's midnight for its whole length, with no reminder,
 * since the pin format has no all-day pin and a reminder at midnight would wake the wearer.
 */
function pinFor(id: string, entry: AgendaEntry, options: PinOptions): TimelinePin {
  const { event } = entry;
  const layout: PinLayout = { type: 'calendarPin', title: event.title, tinyIcon: CALENDAR_ICON };

  if (event.location.trim()) {
    layout.locationName = event.location;
  }

  if (event.description) {
    layout.body = event.description;
  }

  if (event.calendar) {
    layout.headings = ['Calendar'];
    layout.paragraphs = [event.calendar];
  }

  const pin: TimelinePin = {
    id,
    time: new Date(event.startEpoch * 1000).toISOString(),
    duration: Math.max(0, Math.round((event.endEpoch - event.startEpoch) / 60)),
    layout,
  };
  const remindMs = event.startEpoch * 1000 - (options.reminderMinutes ?? 0) * MINUTE_MS;

  if (!event.allDay && options.reminderMinutes !== null && remindMs > options.nowMs) {
    pin.reminders = [{ time: new Date(remindMs).toISOString(), layout: { type: 'genericReminder', title: event.title, tinyIcon: CALENDAR_ICON, ...(layout.locationName ? { locationName: layout.locationName } : {}) } }];
  }

  const actions = options.actionsFor ? options.actionsFor(entry.instanceId) : [];

  if (actions.length > 0) {
    pin.actions = actions;
  }

  return pin;
}

/**
 * What a pin holds for the check that skips sending it again. The reminder goes in as its lead
 * rather than its time, since it is left off once it has passed, and that alone is no change.
 */
function heldBy(pin: TimelinePin, reminderMinutes: number | null): string {
  return fingerprint(JSON.stringify({ ...pin, reminders: undefined, lead: reminderMinutes }));
}

/**
 * The agenda's entries that get a pin: from a feed and no phone, the soonest `PIN_CAP` of them. A new
 * pin has to start inside the timeline's reach, and one already pinned keeps its pin while it is on
 * the agenda, however long ago it started.
 *
 * @param agenda The agenda, soonest first.
 * @param nowMs The time now.
 * @param pinned The instance ids already pinned.
 * @return The entries to pin.
 */
export function pinnedEntries(agenda: AgendaEntry[], nowMs: number, pinned: ReadonlySet<string> = new Set()): AgendaEntry[] {
  return agenda
    .filter((entry) => !entry.sources.includes('phone') && (pinned.has(entry.instanceId) ? entry.event.startEpoch * 1000 <= nowMs + AHEAD_MS : inReach(entry.event, nowMs)))
    .slice(0, PIN_CAP);
}

/**
 * Whether the wearer has denied Timeline, from the permission query. A Pebble app with no query, or
 * one that fails, reads as not denied, since a pin the Pebble app cannot place is only dropped.
 */
async function timelineDenied(pebble: PluginPebble): Promise<boolean> {
  if (!pebble.permissions || typeof pebble.permissions.query !== 'function') {
    return false;
  }

  try {
    return (await pebble.permissions.query('Timeline')) === 'denied';
  } catch {
    return false;
  }
}

/**
 * Brings the timeline in line with the agenda. Every pin call goes through the framework's
 * `insertPin` and `deletePin`, so one that throws is logged and left for the next run, and serving
 * goes on either way. A pin whose delete threw stays on the record, so the next run asks again.
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param storage Where what is pinned is kept, normally `localStorage`.
 * @param agenda The agenda the pins follow, soonest first, at its full length.
 * @param options Whether pins are on, the reminder, and the time now.
 * @return Resolves once every call has settled. It never rejects.
 */
export async function syncPins(pebble: PluginPebble, storage: PinStorage, agenda: AgendaEntry[], options: PinOptions): Promise<void> {
  const record = readRecord(storage);
  const denied = options.on && (await timelineDenied(pebble));
  const wanted = options.on ? pinnedEntries(agenda, options.nowMs, new Set(Object.keys(record.pinned))) : [];
  const wantedIds = new Set(wanted.map((entry) => entry.instanceId));

  for (const [id, forgetMs] of Object.entries(record.retired)) {
    if (forgetMs < options.nowMs) {
      delete record.retired[id];
    }
  }

  for (const [instanceId, kept] of Object.entries(record.pinned)) {
    if (wantedIds.has(instanceId)) {
      continue;
    }

    // an event that ended left the agenda on its own, and its pin stays as the timeline's past
    if (options.on && kept.endMs <= options.nowMs) {
      delete record.pinned[instanceId];
      continue;
    }

    const result = await deletePin(pebble, kept.id);

    if (result.ok) {
      delete record.pinned[instanceId];
      // past two days after its start the event can never be pinned again, so its id is safe to forget
      record.retired[kept.id] = startOf(instanceId) + PAST_MS;
    } else {
      console.log(`Calendar Enhanced + iCal: a pin could not be deleted, ${result.error}`);
    }
  }

  // the Pebble app drops a pin it may not place, so none is asked for while Timeline is denied
  for (const entry of denied ? [] : wanted) {
    const kept = record.pinned[entry.instanceId];
    const pin = pinFor(kept ? kept.id : freshId(entry.instanceId, record.retired), entry, options);
    const held = heldBy(pin, options.reminderMinutes);

    if (kept && kept.held === held) {
      continue;
    }

    const result = await insertPin(pebble, pin);

    if (result.ok) {
      record.pinned[entry.instanceId] = { id: pin.id, endMs: entry.event.endEpoch * 1000, held };
    } else {
      console.log(`Calendar Enhanced + iCal: a pin could not be inserted, ${result.error}`);
    }
  }

  writeRecord(storage, record);
}
