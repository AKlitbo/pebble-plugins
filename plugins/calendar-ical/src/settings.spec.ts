/**
 * Specs for reading Calendar + iCal's saved Look Ahead.
 *
 * Clay saves a select as text, and settings saved by 1.0.x have none.
 * Anything but one of the page's choices has to read as the week, or a stray value gives the wearer a
 * window the page never offered, such as a year walked for every feed on every refresh.
 */

import { describe, test, expect } from 'vitest';
import { lookAheadDays } from './settings';

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
