/**
 * Specs for merging the phone's events and the feeds into one agenda.
 *
 * The duplicate rules are the risk. Too loose and two different meetings at the same time lose one,
 * too tight and a meeting the wearer has on both their phone and a feed shows twice. The cap has to keep
 * the soonest events, and an event's id has to stay the same between runs, or a face reading the
 * agenda sees every event as new each time.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in Toronto. The window runs to the end of
 * Tuesday 10 November there.
 */

import { describe, test, expect } from 'vitest';
import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import { MAX_EVENTS, mergeAgenda } from './agenda';

// Wednesday 4 November 2026, 12:00 in Toronto, which is UTC-5
const NOW = Date.UTC(2026, 10, 4, 17) / 1000;

const HOUR = 60 * 60;

/** A timed hour-long event, some hours from now. */
function event(title: string, hoursAhead: number, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { startEpoch: NOW + hoursAhead * HOUR, endEpoch: NOW + (hoursAhead + 1) * HOUR, allDay: false, title, location: '', ...extra };
}

/** The titles on the agenda, in order. */
function titles(phone: CalendarEvent[], feed1: CalendarEvent[], feed2: CalendarEvent[] = []): string[] {
  return mergeAgenda(phone, [{ source: 'feed1', events: feed1 }, { source: 'feed2', events: feed2 }], NOW).map((entry) => entry.event.title);
}

describe('mergeAgenda', () => {
  /** Each source is sorted on its own, and a face shows the agenda in the order it arrives. */
  test('sorts the sources together by start', () => {
    const result = titles([event('Lunch', 1)], [event('Standup', 0)], [event('Gym', 2)]);

    expect(result).toEqual(['Standup', 'Lunch', 'Gym']);
  });

  /** An event that already ended, or starts past next Tuesday, is not on the agenda. */
  test('keeps an event only while it has not ended and starts inside the week', () => {
    // 22:00 on Tuesday 10 November is the last evening inside the window, and 00:30 the morning after is past it
    const result = titles([event('Done', -2), event('Tuesday night', 6 * 24 + 10), event('Next Wednesday', 6 * 24 + 12.5)], []);

    expect(result).toEqual(['Tuesday night']);
  });

  /** A busy week past the cap must still show what is coming up first. */
  test('keeps the soonest events up to the cap', () => {
    const many = Array.from({ length: MAX_EVENTS + 5 }, (_, index) => event(`Event ${index}`, MAX_EVENTS + 5 - index));

    const result = titles([], many);

    expect([result.length, result[0], result[MAX_EVENTS - 1]]).toEqual([MAX_EVENTS, `Event ${MAX_EVENTS + 4}`, 'Event 5']);
  });

  /** A shared calendar added as both feeds would otherwise show every meeting twice. */
  test('shows an event both feeds carry once', () => {
    const result = titles([], [event('Standup', 1, { uid: 'standup' })], [event('Daily Standup', 1, { uid: 'standup' })]);

    expect(result).toEqual(['Standup']);
  });

  /** Every occurrence of a repeating meeting shares its UID, and the next one is a different meeting. */
  test('keeps two occurrences of one series at different starts', () => {
    const result = titles([], [event('Standup', 1, { uid: 'standup' })], [event('Standup', 25, { uid: 'standup' })]);

    expect(result).toEqual(['Standup', 'Standup']);
  });

  /** A meeting on the phone and in a feed shows once, as the phone's copy the wearer can edit. */
  test("shows an event the phone and a feed share once, as the phone's", () => {
    const result = mergeAgenda([event('Standup', 1, { calendar: 'Phone' })], [{ source: 'feed1', events: [event('  standup ', 1, { calendar: 'Work' })] }], NOW);

    expect(result.map((entry) => entry.event.calendar)).toEqual(['Phone']);
  });

  /** An all-day event and a timed one at midnight are different things, so neither hides the other. */
  test('keeps a phone event and a feed event that differ only in all-day', () => {
    const result = titles([event('Holiday', 1)], [event('Holiday', 1, { allDay: true })]);

    expect(result).toEqual(['Holiday', 'Holiday']);
  });

  /** Two meetings booked for the same time are both real, and the clash is what the wearer needs to see. */
  test('keeps two events at the same time with different titles', () => {
    const result = titles([event('Standup', 1)], [event('Dentist', 1)]);

    expect(result).toEqual(['Standup', 'Dentist']);
  });

  /** An id that moves between runs makes a face treat every event as a new one. */
  test('gives each event the same id on the next run, after an earlier event drops out', () => {
    const later = [event('Lunch', 3), event('Standup', 1, { uid: 'standup' })];

    const first = mergeAgenda([], [{ source: 'feed1', events: [event('Coffee', -0.5), ...later] }], NOW);
    const next = mergeAgenda([], [{ source: 'feed1', events: later }], NOW + HOUR);

    expect(next.map((entry) => entry.instanceId)).toEqual(first.slice(1).map((entry) => entry.instanceId));
  });

  /** A run where the phone could not be read sends the feed's copy, and a face must not see that as a new event. */
  test("keeps a shared event's id on a run where the phone could not be read", () => {
    const feed = [{ source: 'feed1' as const, events: [event('Standup', 1, { uid: 'standup' })] }];

    const both = mergeAgenda([event('Standup', 1)], feed, NOW);
    const feedOnly = mergeAgenda([], feed, NOW);

    expect(feedOnly.map((entry) => entry.instanceId)).toEqual(both.map((entry) => entry.instanceId));
  });

  /** Two phone calendars can hold the same meeting, and an id the Pebble app sees twice loses one. */
  test('gives the same meeting in two phone calendars an id each', () => {
    const result = mergeAgenda([event('Standup', 1, { calendar: 'Work' }), event('Standup', 1, { calendar: 'Team' })], [], NOW);

    expect(new Set(result.map((entry) => entry.instanceId)).size).toBe(2);
  });
});
