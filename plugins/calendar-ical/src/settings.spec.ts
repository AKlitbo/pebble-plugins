/**
 * Specs for reading Calendar + iCal's saved selects and switches.
 *
 * Clay saves a select as text, and settings saved before a select was added have no value for it.
 * Anything but one of the page's choices has to read as the week, or a stray value gives the wearer a
 * window the page never offered, such as a year walked for every feed on every refresh. For Hide
 * Events in Progress it has to read as never, or a wearer who never picked anything loses the meeting
 * they are in.
 *
 * A switch has to read a saved off as off, and anything else as its default. Show All-Day Events opens
 * on, so a wearer updating from 1.1.0 must keep their all-day events.
 */

import { describe, test, expect } from 'vitest';
import { DEFAULTS, hideStartedMinutes, lookAheadDays, switchOn } from './settings';
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
