/**
 * Specs for reading Calendar Enhanced + iCal's saved selects and switches.
 *
 * Clay saves a select as text, and settings saved before a select was added have no value for it.
 * Anything but one of the page's choices has to read as the week, or a stray value gives the wearer a
 * window the page never offered, such as a year walked for every feed on every refresh. For Hide
 * Events in Progress it has to read as never, or a wearer who never picked anything loses the meeting
 * they are in.
 *
 * A switch has to read a saved off as off, and anything else as its default. Show All-Day Events opens
 * on, so a wearer updating from 1.1.0 must keep their all-day events.
 *
 * Time Labels has to read anything but Short Labels as the built-in's text, so a wearer who switches
 * plugins sees no change until they pick otherwise.
 *
 * A feed's Source has to read anything but Public Holidays as an iCal link, so a feed set up before
 * keeps its link.
 *
 * The hidden calendars have to read anything but a saved list of names as none, so every calendar shows.
 *
 * The email addresses have to come apart however the wearer separates them, or an address matches no
 * guest and Hide Declined Events hides nothing.
 */

import { describe, test, expect } from 'vitest';
import { DEFAULTS, emailAddresses, feedSourceOf, hiddenCalendars, hideStartedMinutes, lookAheadDays, pinReminderMinutes, switchOn, timeLabelStyle } from './settings';
import type { SwitchKey } from './settings';

describe('lookAheadDays', () => {
  /** Each choice on the page has to reach the agenda as the days it names. */
  test.each([
    ['1', 1],
    ['3', 3],
    ['7', 7],
    ['14', 14],
    ['31', 31],
  ])('reads the choice %s as its days', (value, days) => {
    const result = lookAheadDays(value);

    expect(result).toBe(days);
  });

  /** A missing or stray value that is not the week changes the agenda for a wearer who never picked anything. */
  test.each([undefined, null, '', 'junk', '0', '2', '30', '400', '7.5', 14.5])('reads %s as the week', (value) => {
    const result = lookAheadDays(value);

    expect(result).toBe(7);
  });
});

describe('hideStartedMinutes', () => {
  /** Each choice on the page has to reach the agenda as the minutes it names, and Never as no cutoff at all. */
  test.each([
    ['never', null],
    ['0', 0],
    ['15', 15],
    ['30', 30],
    ['60', 60],
  ])('reads the choice %s as %s', (value, minutes) => {
    const result = hideStartedMinutes(value);

    expect(result).toBe(minutes);
  });

  /** A missing or stray value that hides anything takes events off the agenda for a wearer who never asked. */
  test.each([undefined, null, '', 'junk', 'Never', '5', '45', '-15', '15.5', true])('reads %s as never', (value) => {
    const result = hideStartedMinutes(value);

    expect(result).toBeNull();
  });
});

describe('timeLabelStyle', () => {
  /** Short Labels on the page have to reach the agenda, or picking them changes nothing. */
  test('reads Short Labels as short', () => {
    const result = timeLabelStyle('short');

    expect(result).toBe('short');
  });

  /** A wearer who never picked anything must keep the built-in's text, whatever stray value is saved. */
  test.each([undefined, null, '', 'builtIn', 'Short', 'junk', true])('reads %j as the built-in', (value) => {
    const result = timeLabelStyle(value);

    expect(result).toBe('builtIn');
  });
});

describe('hiddenCalendars', () => {
  /** The page saves the list as JSON, and a name lost in the read brings that calendar back on the watch. */
  test('reads the saved list as its names', () => {
    const result = hiddenCalendars(JSON.stringify(['Work', 'Family']));

    expect(result).toEqual(['Work', 'Family']);
  });

  /** Settings saved before the list existed, or a value the page never saves, must read as none so every calendar shows. */
  test.each([undefined, null, '', 'Work', '{"Work":true}', 42, JSON.stringify([1, '', null])])('reads %j as none', (value) => {
    const result = hiddenCalendars(value);

    expect(result).toEqual([]);
  });
});

describe('feedSourceOf', () => {
  /** Public Holidays on the page has to reach the feed, or the feed keeps fetching its link. */
  test('reads Public Holidays as holidays', () => {
    const result = feedSourceOf('holidays');

    expect(result).toBe('holidays');
  });

  /** A feed set up before a feed had a Source must keep fetching its iCal link. */
  test.each([undefined, null, '', 'ical', 'Holidays', true])('reads %j as an iCal link', (value) => {
    const result = feedSourceOf(value);

    expect(result).toBe('ical');
  });
});

describe('pinReminderMinutes', () => {
  /** Each choice on the page has to reach the pins as the minutes it names, and None as no reminder at all. */
  test.each([
    ['none', null],
    ['0', 0],
    ['15', 15],
    ['60', 60],
  ])('reads the choice %s as %s', (value, minutes) => {
    const result = pinReminderMinutes(value);

    expect(result).toBe(minutes);
  });

  /** A stray saved value must give the page's own default, not a reminder the page never offered. */
  test.each([undefined, null, '', '7', 'junk'])('reads %j as 15 minutes', (value) => {
    const result = pinReminderMinutes(value);

    expect(result).toBe(15);
  });
});

describe('emailAddresses', () => {
  /** A list split the wrong way gives an address that matches no guest, so the wearer's declined meetings stay. */
  test.each([
    ['me@example.com', ['me@example.com']],
    ['me@example.com, work@example.com', ['me@example.com', 'work@example.com']],
    ['me@example.com;work@example.com', ['me@example.com', 'work@example.com']],
    [' me@example.com  work@example.com ,', ['me@example.com', 'work@example.com']],
  ])('reads %j as its addresses', (value, expected) => {
    const result = emailAddresses(value);

    expect(result).toEqual(expected);
  });

  /** Settings saved before the box existed, or a value the page never saves, must read as no addresses rather than throw. */
  test.each([undefined, null, '', ' , ', 42, true])('reads %j as none', (value) => {
    const result = emailAddresses(value);

    expect(result).toEqual([]);
  });
});

describe('switchOn', () => {
  /** A saved off that reads as on keeps the all-day reminders the wearer turned off. */
  test('reads a saved false as off', () => {
    const result = switchOn({ ...DEFAULTS, ALL_DAY_EVENTS: false }, 'ALL_DAY_EVENTS');

    expect(result).toBe(false);
  });

  /** A value the page never saves, or none at all as in settings saved by 1.1.0, must not flip a switch away from where the page opens it. */
  test.each<[SwitchKey, unknown, boolean]>([
    ['ALL_DAY_EVENTS', undefined, true],
    ['ALL_DAY_EVENTS', null, true],
    ['ALL_DAY_EVENTS', 'false', true],
    ['ALL_DAY_EVENTS', 0, true],
    ['FEED1_ON', 'true', false],
    ['FEED1_ON', 1, false],
  ])('reads %s saved as %j as %s', (key, value, expected) => {
    const result = switchOn({ [key]: value }, key);

    expect(result).toBe(expected);
  });
});
