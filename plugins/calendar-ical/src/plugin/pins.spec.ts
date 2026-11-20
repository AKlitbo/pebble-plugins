/**
 * Specs for the timeline pins for the feeds' events, against the framework's stand-in for the plugin
 * runtime.
 *
 * Which events get a pin is the main risk. A phone event, or a feed event a phone event also holds,
 * would sit on the timeline twice beside the Pebble app's own pin. An event that moved, went, or was
 * filtered off has to lose its pin, and turning the pins off has to clear them all. An unchanged pin
 * must not be sent again on every run, and a pin that comes back after a delete needs an id of its own,
 * since a deleted id may not be usable again. A refused pin call must never stop the run.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in Toronto.
 */

import { describe, test, expect, vi } from 'vitest';
import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import { fakePluginPebble } from '../../paf/ts/testing/plugin-pebble';
import { mergeAgenda } from './agenda';
import type { AgendaEntry } from './agenda';
import { PIN_CAP, syncPins } from './pins';
import type { PinOptions, PinStorage } from './pins';

// Wednesday 4 November 2026, 12:00 in Toronto, which is UTC-5
const NOW_MS = Date.UTC(2026, 10, 4, 17);
const NOW = NOW_MS / 1000;

const HOUR = 60 * 60;

/** A timed hour-long event, some hours from now. */
function event(title: string, hoursAhead: number, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { startEpoch: NOW + hoursAhead * HOUR, endEpoch: NOW + (hoursAhead + 1) * HOUR, allDay: false, title, location: '', ...extra };
}

/** The agenda from the phone's events and one feed's, as a run builds it. */
function agendaOf(phone: CalendarEvent[], feed: CalendarEvent[]): AgendaEntry[] {
  return mergeAgenda(phone, [{ source: 'feed1', events: feed }], NOW, {}, undefined, 200);
}

/** A plain storage that starts empty. */
function fakeStorage(): PinStorage {
  const items = new Map<string, string>();

  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value), removeItem: (key) => void items.delete(key) };
}

/** The pins on, with a 15 minute reminder, at the usual now. */
const ON: PinOptions = { on: true, reminderMinutes: 15, nowMs: NOW_MS };

describe('syncPins', () => {
  /** The pin is what the wearer reads on the timeline, so its text, its times, and its reminder have to be the event's. */
  test('pins a feed event with its title, place, notes, calendar, and reminder', async () => {
    const { pebble, timeline } = fakePluginPebble();

    await syncPins(pebble, fakeStorage(), agendaOf([], [event('Standup', 2, { location: 'Room 4', description: 'Bring the numbers', calendar: 'Team' })]), ON);

    const result = [...timeline.values()];

    expect(result).toEqual([
      {
        id: expect.stringMatching(/^cei-/),
        time: '2026-11-04T19:00:00.000Z',
        duration: 60,
        layout: { type: 'calendarPin', title: 'Standup', tinyIcon: 'system://images/TIMELINE_CALENDAR', locationName: 'Room 4', body: 'Bring the numbers', headings: ['Calendar'], paragraphs: ['Team'] },
        reminders: [{ time: '2026-11-04T18:45:00.000Z', layout: { type: 'genericReminder', title: 'Standup', tinyIcon: 'system://images/TIMELINE_CALENDAR', locationName: 'Room 4' } }],
      },
    ]);
  });

  /** The Pebble app pins the phone's events itself, so a pin here would put them on the timeline twice. */
  test('pins neither a phone event nor a feed event a phone event also holds', async () => {
    const { pebble, timeline } = fakePluginPebble();

    await syncPins(pebble, fakeStorage(), agendaOf([event('Dentist', 1), event('Standup', 2)], [event('Standup', 2), event('Retro', 3)]), ON);

    const result = [...timeline.values()].map((pin) => pin.layout.title);

    expect(result).toEqual(['Retro']);
  });

  /** Sending every pin again on every run would buzz through the Pebble app every five minutes for nothing. */
  test('sends nothing again while the pins are unchanged, and a changed pin again under its id', async () => {
    const { pebble, calls } = fakePluginPebble();
    const storage = fakeStorage();

    await syncPins(pebble, storage, agendaOf([], [event('Standup', 2)]), ON);
    await syncPins(pebble, storage, agendaOf([], [event('Standup', 2)]), ON);
    await syncPins(pebble, storage, agendaOf([], [event('Standup', 2, { location: 'Room 9' })]), ON);

    const result = calls.map((call) => (call.call === 'insert' ? `insert ${call.pin.id} ${call.pin.layout.locationName ?? ''}` : `delete ${call.id}`));

    expect(result).toEqual([expect.stringMatching(/^insert cei-\S+ $/), expect.stringMatching(/^insert cei-\S+ Room 9$/)]);
  });

  /** A pin left behind for an event that moved or went would send the wearer to a meeting that is not there. */
  test('deletes the pin of an event that left the agenda', async () => {
    const { pebble, timeline } = fakePluginPebble();
    const storage = fakeStorage();

    await syncPins(pebble, storage, agendaOf([], [event('Standup', 2), event('Retro', 3)]), ON);
    await syncPins(pebble, storage, agendaOf([], [event('Retro', 3)]), ON);

    const result = [...timeline.values()].map((pin) => pin.layout.title);

    expect(result).toEqual(['Retro']);
  });

  /** A meeting that is over belongs in the timeline's past, where the wearer scrolls back to find it. */
  test('keeps the pin of an event that ended', async () => {
    const { pebble, timeline } = fakePluginPebble();
    const storage = fakeStorage();

    await syncPins(pebble, storage, agendaOf([], [event('Standup', 2)]), ON);
    await syncPins(pebble, storage, [], { ...ON, nowMs: NOW_MS + 4 * HOUR * 1000 });

    const result = timeline.size;

    expect(result).toBe(1);
  });

  /** Turning the pins off has to take every one of them off the timeline. */
  test('deletes every pin when the pins are turned off', async () => {
    const { pebble, timeline } = fakePluginPebble();
    const storage = fakeStorage();

    await syncPins(pebble, storage, agendaOf([], [event('Standup', 2), event('Retro', 3)]), ON);
    await syncPins(pebble, storage, agendaOf([], [event('Standup', 2), event('Retro', 3)]), { ...ON, on: false });

    const result = timeline.size;

    expect(result).toBe(0);
  });

  /** A deleted id may not be usable again, so an event that comes back has to go in under a new one. */
  test('gives an event that comes back after a delete a fresh id', async () => {
    const { pebble, calls } = fakePluginPebble();
    const storage = fakeStorage();

    await syncPins(pebble, storage, agendaOf([], [event('Standup', 2)]), ON);
    await syncPins(pebble, storage, [], ON);
    await syncPins(pebble, storage, agendaOf([], [event('Standup', 2)]), ON);

    const ids = calls.filter((call) => call.call === 'insert').map((call) => (call.call === 'insert' ? call.pin.id : ''));
    const result = [ids.length, ids[0] !== ids[1], ids[1].endsWith('~2')];

    expect(result).toEqual([2, true, true]);
  });

  /** The pin format has no all-day pin, and a reminder at midnight would wake the wearer. */
  test('pins an all-day event at its midnight for its whole length, with no reminder', async () => {
    const { pebble, timeline } = fakePluginPebble();
    // all of Thursday 5 November in Toronto
    const holiday = { startEpoch: Date.UTC(2026, 10, 5, 5) / 1000, endEpoch: Date.UTC(2026, 10, 6, 5) / 1000, allDay: true, title: 'Holiday', location: '' };

    await syncPins(pebble, fakeStorage(), agendaOf([], [holiday]), ON);

    const result = [...timeline.values()].map((pin) => [pin.time, pin.duration, pin.reminders]);

    expect(result).toEqual([['2026-11-05T05:00:00.000Z', 1440, undefined]]);
  });

  /** A reminder already past would show the moment the pin lands, for a meeting already close or under way. */
  test('leaves off a reminder whose time has passed', async () => {
    const { pebble, timeline } = fakePluginPebble();

    await syncPins(pebble, fakeStorage(), agendaOf([], [event('Soon', 0.1)]), ON);

    const result = [...timeline.values()].map((pin) => pin.reminders);

    expect(result).toEqual([undefined]);
  });

  /** A month of a busy feed would otherwise send hundreds of pins the wearer never scrolls to. */
  test(`keeps the soonest ${PIN_CAP} pins`, async () => {
    const { pebble, timeline } = fakePluginPebble();
    const many = Array.from({ length: PIN_CAP + 5 }, (_, index) => event(`Event ${index}`, index + 1));

    await syncPins(pebble, fakeStorage(), agendaOf([], many), ON);

    const result = [timeline.size, [...timeline.values()].some((pin) => pin.layout.title === `Event ${PIN_CAP}`)];

    expect(result).toEqual([PIN_CAP, false]);
  });

  /** The timeline takes no pin more than two days back, so a long event begun before then is left off. */
  test('pins no event that started more than two days ago', async () => {
    const { pebble, timeline } = fakePluginPebble();

    await syncPins(pebble, fakeStorage(), agendaOf([], [{ ...event('Conference', -72), endEpoch: NOW + 24 * HOUR }, event('Standup', 2)]), ON);

    const result = [...timeline.values()].map((pin) => pin.layout.title);

    expect(result).toEqual(['Standup']);
  });

  /** A wearer who has not allowed Timeline still has to get the agenda, and the pin has to be tried again next run. */
  test.each(['throw', 'reject', 'missing'] as const)('logs a pin call that fails by %s and keeps nothing as pinned', async (failure) => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const broken = fakePluginPebble({ pins: failure });
    const storage = fakeStorage();
    const working = fakePluginPebble();

    await syncPins(broken.pebble, storage, agendaOf([], [event('Standup', 2)]), ON);
    await syncPins(working.pebble, storage, agendaOf([], [event('Standup', 2)]), ON);

    const result = [logged.mock.calls.length > 0, working.timeline.size];

    expect(result).toEqual([true, 1]);
    logged.mockRestore();
  });

  /** The Pebble app drops a pin it is not allowed to place without a word, so pins asked for then must go in once Timeline is granted. */
  test('inserts nothing while Timeline is not granted, and every pin once it is', async () => {
    // the Pebble app drops a pin it may not place, then places them once the wearer allows Timeline
    const denied = fakePluginPebble({ pins: 'dropped' });
    const granted = fakePluginPebble();
    const storage = fakeStorage();

    denied.pebble.permissions = { query: async () => 'denied' };
    granted.pebble.permissions = { query: async () => 'granted' };
    await syncPins(denied.pebble, storage, agendaOf([], [event('Standup', 2)]), ON);
    await syncPins(granted.pebble, storage, agendaOf([], [event('Standup', 2)]), ON);

    const result = [denied.calls.length, granted.timeline.size];

    expect(result).toEqual([0, 1]);
  });

  /** The Pebble app only asks the wearer about Timeline once a pin uses it, so holding back until asked would never ask. */
  test('pins as normal while Timeline has not been asked about', async () => {
    const { pebble, timeline } = fakePluginPebble();

    pebble.permissions = { query: async () => 'prompt' };
    await syncPins(pebble, fakeStorage(), agendaOf([], [event('Standup', 2)]), ON);

    const result = timeline.size;

    expect(result).toBe(1);
  });

  /** Pins placed before Timeline was taken away must still come off when the switch goes off. */
  test('still deletes the pins while Timeline is denied', async () => {
    const granted = fakePluginPebble();
    const denied = fakePluginPebble();
    const storage = fakeStorage();

    await syncPins(granted.pebble, storage, agendaOf([], [event('Standup', 2)]), ON);
    denied.pebble.permissions = { query: async () => 'denied' };
    await syncPins(denied.pebble, storage, agendaOf([], [event('Standup', 2)]), { ...ON, on: false });

    const result = denied.calls.map((call) => call.call);

    expect(result).toEqual(['delete']);
  });

  /** The two days back limit is for new pins, and a long event already pinned must not lose its pin partway. */
  test('keeps the pin of an event that started more than two days ago', async () => {
    const { pebble, calls } = fakePluginPebble();
    const storage = fakeStorage();
    // a week-long conference that starts in an hour
    const conference = [{ ...event('Conference', 1), endEpoch: NOW + 7 * 24 * HOUR }];

    await syncPins(pebble, storage, agendaOf([], conference), ON);
    await syncPins(pebble, storage, mergeAgenda([], [{ source: 'feed1', events: conference }], NOW + 3 * 24 * HOUR, { days: 7 }, undefined, 200), { ...ON, nowMs: NOW_MS + 3 * 24 * HOUR * 1000 });

    const result = calls.map((call) => call.call);

    expect(result).toEqual(['insert']);
  });
});
