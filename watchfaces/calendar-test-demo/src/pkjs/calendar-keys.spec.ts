/**
 * Specs for the calendar face's own key and the agenda it logs.
 *
 * The calendars' names only help the watch if each lands on its own event, and the framework sorts,
 * trims, and rounds the plugin's events before it packs them. So finding each event back by title and
 * start, through an all-day event's rounding, is what is worth pinning. So is the agenda's byte layout,
 * since a wrong offset would log a time the watch never showed.
 */
import { describe, expect, test } from 'vitest';
import { calendarNames, createAgendaNames, decodeAgenda } from './calendar-keys';
import type { AgendaEvent } from './calendar-keys';

// 13 Nov 2026 at 00:00 UTC
const DAY_START = 1794528000;

/** An event as the plugin sends it. */
function instance(name: string, startsAt: number, calendar: string) {
  return { properties: { name: { longText: { text: name } }, starts_at: { timestamp: { value: startsAt } }, calendar: { longText: { text: calendar } } } };
}

/** An agenda event as the watch will read it. */
function agendaEvent(title: string, start: number): AgendaEvent {
  return { start, end: start + 3600, allDay: false, title, location: '' };
}

describe('calendarNames', () => {
  /** The framework sorts by start, so the names have to follow the agenda's order, not the plugin's. */
  test('names each event in the agenda order, whatever order the plugin sent', () => {
    const envelope = { instances: [instance('Dentist', DAY_START + 7200, 'Personal'), instance('Standup', DAY_START + 3600, 'Work')] };
    const events = [agendaEvent('Standup', DAY_START + 3600), agendaEvent('Dentist', DAY_START + 7200)];

    const result = calendarNames(events, envelope);

    expect(result).toEqual(['Work', 'Personal']);
  });

  /** An all-day event moves to the phone's midnight on the way, and still has to find its calendar. */
  test('finds an all-day event the framework moved to the local midnight', () => {
    const envelope = { instances: [instance('Holiday', DAY_START, 'Holidays in Canada')] };
    const events = [agendaEvent('Holiday', DAY_START + 5 * 3600)];

    const result = calendarNames(events, envelope);

    expect(result).toEqual(['Holidays in Canada']);
  });

  /** Two events alike in title and start each take a calendar, rather than both taking the first. */
  test('gives each of two matching events a calendar of its own', () => {
    const envelope = { instances: [instance('Lunch', DAY_START, 'Work'), instance('Lunch', DAY_START, 'Family')] };
    const events = [agendaEvent('Lunch', DAY_START), agendaEvent('Lunch', DAY_START)];

    const result = calendarNames(events, envelope);

    expect(result).toEqual(['Work', 'Family']);
  });

  /** The agenda cuts a title to 24 characters, so the match has to compare the cut title. */
  test('matches a title the agenda cut short', () => {
    const long = 'Quarterly planning review with the whole team';
    const envelope = { instances: [instance(long, DAY_START, 'Work')] };
    const events = [agendaEvent(long.slice(0, 24), DAY_START)];

    const result = calendarNames(events, envelope);

    expect(result).toEqual(['Work']);
  });

  /** A name with no match has to read as none, not as a neighbour's calendar. */
  test('leaves an event with no match unnamed', () => {
    const result = calendarNames([agendaEvent('Standup', DAY_START)], { instances: [instance('Standup', DAY_START + 86400, 'Work')] });

    expect(result).toEqual(['']);
  });
});

describe('decodeAgenda', () => {
  /** A wrong offset would log a time or a title the watch never showed. */
  test('reads an event with its title and place', () => {
    const start = [0x00, 0x15, 0xf6, 0x6a];
    const end = [0x10, 0x23, 0xf6, 0x6a];
    const bytes = [1, ...start, ...end, 1, 2, 72, 105, 1, 88];

    const result = decodeAgenda(bytes);

    expect(result).toEqual([{ start: 0x6af61500, end: 0x6af62310, allDay: true, title: 'Hi', location: 'X' }]);
  });

  /** An agenda that stops short is what the watch refuses, so the log has to say so rather than guess. */
  test('refuses an agenda that claims more events than it carries', () => {
    const result = decodeAgenda([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    expect(result).toBeNull();
  });
});

describe('createAgendaNames', () => {
  const keys = { CALENDAR_STRIP: 30, TEST_CALENDARS: 31 };
  const strip = [1, 0x00, 0x15, 0xf6, 0x6a, 0x10, 0x23, 0xf6, 0x6a, 0, 2, 72, 105, 0];

  /**
   * The framework drops an agenda that matches the last one, so a renamed calendar alone sends no
   * agenda. The names have to change in the report anyway, or the watch keeps the old name.
   */
  test('changes the names when only the calendar was renamed', () => {
    const names = createAgendaNames();

    names.noticeSend({ 30: strip }, keys);

    const result = [names.extras({ instances: [instance('Hi', 0x6af61500, 'Work')] }, keys), names.extras({ instances: [instance('Hi', 0x6af61500, 'Office')] }, keys)];

    expect(result).toEqual([{ 31: 'Work' }, { 31: 'Office' }]);
  });

  /** Names sent before any agenda would sit on slots the watch does not have yet. */
  test('adds nothing before an agenda has gone to the watch', () => {
    const names = createAgendaNames();

    names.noticeSend({ 10: 'Calendar + iCal' }, keys);

    const result = names.extras({ instances: [instance('Hi', 0x6af61500, 'Work')] }, keys);

    expect(result).toEqual({});
  });
});
