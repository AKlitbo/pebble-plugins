/**
 * Specs for the log lines.
 *
 * The log is how a test on a real phone gets read, and `pebble logs` crashed on a line cut through a
 * two byte character. So every line staying plain ASCII and under the cap is what is worth pinning,
 * along with a split that loses nothing.
 */
import { describe, expect, test } from 'vitest';
import { asciiLine, LINE_MAX, logLines } from './log-lines';

describe('asciiLine', () => {
  /** A degree sign is two bytes, and a cut between them crashed pebble logs. */
  test('writes a degree sign as deg and anything else outside ASCII as its code', () => {
    const result = asciiLine('shortText "82°F" Montréal');

    expect(result).toBe('shortText "82degF" Montr\\u00e9al');
  });
});

describe('logLines', () => {
  /** A short line goes out as it is, so the common case reads cleanly. */
  test('tags a short line and leaves it whole', () => {
    const result = logLines('weather-test-demo', 'ready');

    expect(result).toEqual(['[weather-test-demo] ready']);
  });

  /** A line past the cap would be cut by the phone, so it goes out as tagged pieces under it. */
  test('splits a long line into tagged ASCII pieces under the cap', () => {
    const body = Array.from({ length: 40 }, (unused, index) => `hourly_${index}°`).join(', ');

    const result = logLines('weather-test-demo', body);

    expect(result.length).toBeGreaterThan(1);
    expect(result.every((line) => line.length <= LINE_MAX && /^\[weather-test-demo\] [ -~]*$/.test(line))).toBe(true);
  });

  /** A split that drops or doubles a character would misreport the value it lands in. */
  test('loses nothing between the pieces of a split line', () => {
    const body = Array.from({ length: 40 }, (unused, index) => `hourly_${index}°`).join(', ');
    const first = '[weather-test-demo] '.length;
    const more = '[weather-test-demo]   + '.length;

    const result = logLines('weather-test-demo', body);

    expect(result.map((line, index) => line.slice(index === 0 ? first : more)).join(' ')).toBe(asciiLine(body));
  });

  /** A run with no space to break at, such as a long uuid list, still has to come under the cap. */
  test('cuts a line with no space at the cap', () => {
    const body = 'x'.repeat(300);

    const result = logLines('stock-test-demo', body);

    expect(result.every((line) => line.length <= LINE_MAX)).toBe(true);
    expect(result.map((line) => line.replace(/^\[stock-test-demo\] ( {2}\+ )?/, '')).join('')).toBe(body);
  });
});
