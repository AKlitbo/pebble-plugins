/**
 * Specs for merging the phone's events and the feeds into one agenda.
 *
 * The duplicate rules are the risk. Too loose and two different meetings at the same time lose one,
 * too tight and a meeting the wearer has on both their phone and a feed shows twice. The cap has to keep
 * the soonest events, and an event's id has to stay the same between runs, or a face reading the
 * agenda sees every event as new each time.
 *
 * The wearer's filters are pinned at their edges. Hide Events in Progress has to take a timed event
 * off on the second its cutoff comes, the same second the answer runs out. It must never touch an
 * all-day event, or every one of them would go at midnight, nor a timed event a day or longer, which is
 * still current long after it starts. Show All-Day Events has to reach the phone's
 * events and the feeds' alike. Both have to come before the cap, or a hidden event leaves the agenda
 * short. Each of Hide Declined, Tentative, and Free Events has to take off only the events marked its
 * own way, and Hide Free Events must leave all-day events alone, since holiday feeds mark them free.
 *
 * The answer runs out the next moment the agenda changes on its own, so that moment has to be the
 * soonest of every event's end and every cutoff that applies, or a reader keeps an event that has gone.
 *
 * A shared event has to name every source that holds it and carry a feed's marks onto the phone's copy
 * without changing the phone's own event. Its id must never carry the title.
 *
 * Hide Events Titled has to reach every source and come before the cap like the other filters.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in Toronto. The window runs to the end of
 * Tuesday 10 November there.
 */

import { describe, test, expect } from 'vitest';
import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import { MAX_EVENTS, mergeAgenda, nextChange } from './agenda';
import type { AgendaFilters } from './agenda';

// Wednesday 4 November 2026, 12:00 in Toronto, which is UTC-5
const NOW = Date.UTC(2026, 10, 4, 17) / 1000;

const MINUTE = 60;
const HOUR = 60 * MINUTE;

// midnight on Wednesday 4 November in Toronto, where today's all-day events start
const MIDNIGHT = Date.UTC(2026, 10, 4, 5) / 1000;

/** A timed hour-long event, some hours from now. */
function event(title: string, hoursAhead: number, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { startEpoch: NOW + hoursAhead * HOUR, endEpoch: NOW + (hoursAhead + 1) * HOUR, allDay: false, title, location: '', ...extra };
}

/** A timed two-hour event that started some minutes ago. */
function started(title: string, minutesAgo: number): CalendarEvent {
  const startEpoch = NOW - minutesAgo * MINUTE;

  return { startEpoch, endEpoch: startEpoch + 2 * HOUR, allDay: false, title, location: '' };
}

/** An all-day event today. */
function allDay(title: string): CalendarEvent {
  return { startEpoch: MIDNIGHT, endEpoch: MIDNIGHT + 24 * HOUR, allDay: true, title, location: '' };
}

/** The filters a wearer who never opens them has, with these ones set. */
function filtersWith(set: Partial<AgendaFilters>): AgendaFilters {
  return { hideStartedAfter: null, allDay: true, ...set };
}

/** The titles on the agenda under these filters, in order. */
function filtered(phone: CalendarEvent[], feed: CalendarEvent[], set: Partial<AgendaFilters>): string[] {
  return mergeAgenda(phone, [{ source: 'feed1', events: feed }], NOW, {}, filtersWith(set)).map((entry) => entry.event.title);
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

describe('Hide Events in Progress', () => {
  const DAY = [started('Started 45 Ago', 45), started('Started 20 Ago', 20), started('Started 5 Ago', 5), event('Next Hour', 1)];

  /** Each choice has to hide what it names and nothing more, or the wearer loses a meeting they still wanted. */
  test.each([
    [null, ['Started 45 Ago', 'Started 20 Ago', 'Started 5 Ago', 'Next Hour']],
    [0, ['Next Hour']],
    [15, ['Started 5 Ago', 'Next Hour']],
    [30, ['Started 20 Ago', 'Started 5 Ago', 'Next Hour']],
    [60, ['Started 45 Ago', 'Started 20 Ago', 'Started 5 Ago', 'Next Hour']],
  ])('with %s minutes keeps %j', (hideStartedAfter, expected) => {
    const result = filtered([], DAY, { hideStartedAfter });

    expect(result).toEqual(expected);
  });

  /** The answer runs out on the cutoff, so an event still kept on that second would outlast the answer that said it was going. */
  test('takes an event off on the second it has been going 15 minutes', () => {
    const atCutoff = started('At Cutoff', 15);
    const justInside = { ...started('Just Inside', 15), startEpoch: NOW - 15 * MINUTE + 1 };

    const result = filtered([atCutoff, justInside], [], { hideStartedAfter: 15 });

    expect(result).toEqual(['Just Inside']);
  });

  /** When They Start means the meeting goes the moment it begins, not a minute into it. */
  test('takes an event off on the second it starts with When They Start', () => {
    const startsNow = started('Starts Now', 0);
    const nextSecond = { ...started('Next Second', 0), startEpoch: NOW + 1 };

    const result = filtered([startsNow, nextSecond], [], { hideStartedAfter: 0 });

    expect(result).toEqual(['Next Second']);
  });

  /** A hotel stay is still on for days after check-in, so a cutoff on it would lose it for the whole trip. */
  test('keeps a timed event a day or longer past its cutoff, and hides a shorter one', () => {
    const hotel = { ...started('Hotel', 3 * 60), endEpoch: NOW - 3 * HOUR + 3 * 24 * HOUR };
    const fullDay = { ...started('Full Day', 2 * 60), endEpoch: NOW - 2 * HOUR + 24 * HOUR };
    const overnight = { ...started('Overnight Shift', 90), endEpoch: NOW - 90 * MINUTE + 23 * HOUR };
    const meeting = started('Planning', 60);

    const result = filtered([hotel, fullDay, overnight, meeting], [], { hideStartedAfter: 15 });

    expect(result).toEqual(['Hotel', 'Full Day']);
  });

  /** Every all-day event starts at midnight, so treating one as in progress would empty the day of them. */
  test("keeps the phone's and the feeds' all-day events", () => {
    const result = filtered([allDay('Holiday')], [allDay('Out of Office')], { hideStartedAfter: 0 });

    expect(result).toEqual(['Holiday', 'Out of Office']);
  });
});

describe('Show All-Day Events', () => {
  const PHONE = [allDay('Holiday'), event('Dentist', 1)];
  const FEED = [allDay('Out of Office'), event('Standup', 2)];

  /** All-day reminders crowd out the next real meeting, from whichever calendar they come. */
  test("drops the phone's and the feeds' all-day events when off, and keeps the timed ones", () => {
    const result = filtered(PHONE, FEED, { allDay: false });

    expect(result).toEqual(['Dentist', 'Standup']);
  });

  /** A wearer who leaves it on has to keep seeing every all-day event. */
  test("keeps the phone's and the feeds' all-day events when on", () => {
    const result = filtered(PHONE, FEED, { allDay: true });

    expect(result).toEqual(['Holiday', 'Out of Office', 'Dentist', 'Standup']);
  });
});

describe('the filters', () => {
  /** A cut taken before the filters leaves the agenda short by every event they hide. */
  test('fill the cap from what is left after them', () => {
    const hidden = [allDay('Status 1'), allDay('Status 2'), started('Running 1', 10), started('Running 2', 5)];
    const upcoming = Array.from({ length: MAX_EVENTS }, (_, index) => event(`Event ${index}`, index + 1));

    const result = filtered([], [...hidden, ...upcoming], { hideStartedAfter: 0, allDay: false });

    expect([result.length, result[0], result[MAX_EVENTS - 1]]).toEqual([MAX_EVENTS, 'Event 0', `Event ${MAX_EVENTS - 1}`]);
  });

  /** A wearer who never opens the filters reads them as Never with all-day events shown, and their agenda must not change. */
  test('leave the agenda as it is on Never with all-day events shown', () => {
    const result = filtered([allDay('Holiday'), started('Planning', 30)], [event('Standup', 1)], { hideStartedAfter: null, allDay: true });

    expect(result).toEqual(['Holiday', 'Planning', 'Standup']);
  });
});

describe('Hide Declined, Tentative, and Free Events', () => {
  const MARKED = [event('Declined', 1, { declined: true }), event('Tentative', 2, { tentative: true }), event('Free', 3, { free: true }), event('Standup', 4)];

  /** Each switch has to take off the events marked its own way and leave the others, or a wearer loses meetings they are going to. */
  test.each<[Partial<AgendaFilters>, string[]]>([
    [{ hideDeclined: true }, ['Tentative', 'Free', 'Standup']],
    [{ hideTentative: true }, ['Declined', 'Free', 'Standup']],
    [{ hideFree: true }, ['Declined', 'Tentative', 'Standup']],
  ])('drops only the marked events under %j', (set, expected) => {
    const result = filtered([], MARKED, set);

    expect(result).toEqual(expected);
  });

  /** A wearer who never turns them on must keep every event, marked or not. */
  test('keeps marked events with the switches off', () => {
    const result = filtered([], MARKED, {});

    expect(result).toEqual(['Declined', 'Tentative', 'Free', 'Standup']);
  });

  /** Holiday feeds mark every holiday free, so hiding free all-day events would empty a holiday calendar. */
  test('keeps an all-day event marked free under Hide Free Events', () => {
    const result = filtered([], [{ ...allDay('Remembrance Day'), free: true }, event('Free', 1, { free: true })], { hideFree: true });

    expect(result).toEqual(['Remembrance Day']);
  });
});

describe('nextChange', () => {
  /** The answer has to run out when the first event goes, not a later one, or that event lingers. */
  test('gives the soonest moment an event on the agenda leaves', () => {
    const agenda = mergeAgenda([started('Started 5 Ago', 5), started('Started 10 Ago', 10), event('Next Hour', 1)], [], NOW, {}, filtersWith({ hideStartedAfter: 15 }));

    const result = nextChange(agenda, 15);

    expect(result).toBe(NOW + 5 * MINUTE);
  });

  /** A meeting that ends before its cutoff is gone by then, so a reader waiting for the cutoff keeps it after it ended. */
  test('gives the second after a meeting ends when its cutoff falls after that', () => {
    const shortMeeting = { ...started('Quick Sync', 10), endEpoch: NOW + 2 * MINUTE };
    const agenda = mergeAgenda([shortMeeting], [], NOW, {}, filtersWith({ hideStartedAfter: 15 }));

    const result = nextChange(agenda, 15);

    expect(result).toBe(NOW + 2 * MINUTE + 1);
  });

  /** With Never picked an event still leaves when it ends, and the answer must not outlast it. */
  test('gives the second after the soonest end with Never', () => {
    const agenda = mergeAgenda([started('Planning', 5), event('Next Hour', 1)], [], NOW);

    const result = nextChange(agenda, null);

    expect(result).toBe(NOW - 5 * MINUTE + 2 * HOUR + 1);
  });

  /** An all-day event never leaves under the filter, so its midnight start must not cut the answer short. */
  test("gives an all-day event's end rather than a cutoff under When They Start", () => {
    const agenda = mergeAgenda([allDay('Holiday')], [], NOW, {}, filtersWith({ hideStartedAfter: 0 }));

    const result = nextChange(agenda, 0);

    expect(result).toBe(MIDNIGHT + 24 * HOUR + 1);
  });

  /** A hotel stay's cutoff passed hours ago, and counting it would give an answer that has already run out. */
  test('leaves out the cutoff of a timed event a day or longer', () => {
    const hotel = { ...started('Hotel', 60), endEpoch: NOW + 2 * 24 * HOUR };
    const agenda = mergeAgenda([hotel], [], NOW, {}, filtersWith({ hideStartedAfter: 15 }));

    const result = nextChange(agenda, 15);

    expect(result).toBe(NOW + 2 * 24 * HOUR + 1);
  });

  /** An empty agenda has nothing to run out on, so the answer keeps its full five minutes. */
  test('gives nothing for an empty agenda', () => {
    const result = nextChange([], 0);

    expect(result).toBeNull();
  });
});

describe('the sources', () => {
  /** What goes by where an event came from has to see every source that holds it, or a phone event a feed also holds reads as the feed's alone. */
  test('names every source that holds each event, the kept copy first', () => {
    const agenda = mergeAgenda([event('Dentist', 1)], [{ source: 'feed1', events: [event('dentist', 1), event('Standup', 2, { uid: 'standup' })] }, { source: 'feed2', events: [event('Dentist', 1), event('Standup', 2, { uid: 'standup' })] }], NOW);

    const result = agenda.map((entry) => [entry.event.title, entry.sources]);

    expect(result).toEqual([
      ['Dentist', ['phone', 'feed1', 'feed2']],
      ['Standup', ['feed1', 'feed2']],
    ]);
  });
});

describe('the marks on a shared event', () => {
  /** The phone sends no marks, so a meeting declined in a feed and also on the phone would never leave under Hide Declined Events. */
  test("carries a feed's marks onto the phone's copy, from either feed", () => {
    const agenda = mergeAgenda([event('Offsite', 1)], [{ source: 'feed1', events: [event('Offsite', 1, { declined: true })] }, { source: 'feed2', events: [event('Offsite', 1, { tentative: true, free: true })] }], NOW);

    const result = agenda.map(({ event: kept }) => [kept.declined, kept.tentative, kept.free]);

    expect(result).toEqual([[true, true, true]]);
  });

  /** Marks written into the phone's own event would land in the kept phone read and outlive the feed that sent them. */
  test("leaves the phone's own event without the marks", () => {
    const phoneEvent = event('Offsite', 1);

    mergeAgenda([phoneEvent], [{ source: 'feed1', events: [event('Offsite', 1, { declined: true })] }], NOW);

    expect(phoneEvent.declined).toBeUndefined();
  });

  /** Hide Declined Events has to reach the phone's copy once it carries the feed's mark. */
  test('hides the shared event under Hide Declined Events', () => {
    const result = filtered([event('Offsite', 1), event('Standup', 2)], [event('Offsite', 1, { declined: true })], { hideDeclined: true });

    expect(result).toEqual(['Standup']);
  });
});

describe('the ids', () => {
  /** An id holding the title would hand it to anything that reads the ids, which never needs it. */
  test('carry the start and a fingerprint of the title, never the title', () => {
    const agenda = mergeAgenda([], [{ source: 'feed1', events: [event('Salary Review', 1)] }], NOW);

    const result = agenda[0].instanceId;

    expect([result.startsWith(`${NOW + HOUR}:`), result.toLowerCase().includes('salary')]).toEqual([true, false]);
  });

  /** A title typed with other case or spaces at its ends is the same event to the duplicate check, and must keep its id. */
  test('stay the same for a title in another case or with spaces at its ends', () => {
    const first = mergeAgenda([], [{ source: 'feed1', events: [event('Standup', 1)] }], NOW);

    const result = mergeAgenda([], [{ source: 'feed1', events: [event(' standup ', 1)] }], NOW);

    expect(result[0].instanceId).toBe(first[0].instanceId);
  });
});

describe('Hide Events Titled', () => {
  /** The words have to reach the phone's events and the feeds' alike, or a phone's Lunch blocks still crowd out the next meeting. */
  test("drops the phone's and the feeds' events whose titles match, and keeps the rest", () => {
    const result = filtered([event('Team Lunch', 1), event('Dentist', 2)], [event('Canceled: Standup', 3), event('Brunch', 4)], { hideTitled: ['lunch', 'canceled:'] });

    expect(result).toEqual(['Dentist', 'Brunch']);
  });

  /** A filter after the cut leaves the agenda short by every event it hides. */
  test('fills the cap from what is left after it', () => {
    const lunches = Array.from({ length: 5 }, (_, index) => event(`Lunch ${index}`, index + 1));
    const upcoming = Array.from({ length: MAX_EVENTS }, (_, index) => event(`Event ${index}`, index + 10));

    const result = filtered([], [...lunches, ...upcoming], { hideTitled: ['lunch'] });

    expect([result.length, result[0]]).toEqual([MAX_EVENTS, 'Event 0']);
  });
});
