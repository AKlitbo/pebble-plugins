/**
 * Specs for the public holiday calendars a feed can follow.
 *
 * The link is built from the country each run, so a wrong character in it fetches nothing for every
 * wearer in that country. The id's `#` and `@` have to be encoded, or the fetch drops everything after
 * the `#` and the cache stamp lands inside the id. Observances off has to fetch the `.official`
 * calendar, which holds the public holidays alone. A saved country that is not in the table has to
 * fall back to one that is, rather than build a link to nothing.
 */

import { describe, test, expect } from 'vitest';
import { HOLIDAY_CALENDARS, holidayCalendar, holidayLink, isAutomaticName } from './holidays';

describe('holidayLink', () => {
  /** Observances off has to fetch the calendar of public holidays alone, with the id encoded. */
  test('builds the public holidays link for a country', () => {
    const result = holidayLink(holidayCalendar('gb'), false);

    expect(result).toBe('https://calendar.google.com/calendar/ical/en.uk.official%23holiday%40group.v.calendar.google.com/public/basic.ics');
  });

  /** Observances on has to fetch the calendar that carries them too. */
  test('builds the link with the observances when asked', () => {
    const result = holidayLink(holidayCalendar('us'), true);

    expect(result).toBe('https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics');
  });
});

describe('holidayCalendar', () => {
  /** A stray saved value must still give a feed that fetches, not a link built from nothing. */
  test.each([undefined, null, '', 'xx', 'US'])('reads %j as the United States', (value) => {
    const result = holidayCalendar(value).id;

    expect(result).toBe('us');
  });
});

describe('HOLIDAY_CALENDARS', () => {
  /** Two countries saving the same value would make one of them impossible to pick. */
  test('gives each country its own value and its own calendar', () => {
    const result = [new Set(HOLIDAY_CALENDARS.map((calendar) => calendar.id)).size, new Set(HOLIDAY_CALENDARS.map((calendar) => calendar.google)).size];

    expect(result).toEqual([HOLIDAY_CALENDARS.length, HOLIDAY_CALENDARS.length]);
  });
});

describe('isAutomaticName', () => {
  /** A name the page filled in has to give way to the country picked, or Canada's holidays go out as US Holidays. */
  test.each(['', '  ', 'Feed 1', 'US Holidays', ' Canada Holidays '])('reads %j as filled in', (name) => {
    const result = isAutomaticName(name, 'Feed 1');

    expect(result).toBe(true);
  });

  /** A name the wearer typed is theirs, and the country must not replace it. */
  test.each(['Days Off', 'Feed 2', 'us holidays'])('reads %j as typed', (name) => {
    const result = isAutomaticName(name, 'Feed 1');

    expect(result).toBe(false);
  });
});
