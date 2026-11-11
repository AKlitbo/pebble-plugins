/**
 * Specs for fetching and keeping Calendar + iCal's feeds.
 *
 * The plugin runs every five minutes with no memory but storage, so whether a feed is fetched is
 * decided from its kept copy. Fetching too often spends the wearer's data on a feed that has not
 * changed, and a failed fetch that wipes the copy empties the agenda until the feed comes back. A copy
 * kept across a changed link would serve the old calendar's events under the new one.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in Toronto, and every event is the next day.
 */

import { describe, test, expect, vi } from 'vitest';
import { copyKey, feedEvents } from './feeds';
import type { Feed, FeedStorage } from './feeds';

// Wednesday 4 November 2026, 12:00 in Toronto
const NOW_MS = Date.UTC(2026, 10, 4, 17);

const MINUTE_MS = 60 * 1000;

const FEED: Feed = { slot: 1, on: true, name: 'Work', url: 'https://example.com/work.ics' };

/** A feed of one timed event, Thursday 5 November 2026 at 15:00 UTC. */
function calendarOf(title: string): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${title}@example.com`, 'DTSTART:20261105T150000Z', 'DTEND:20261105T160000Z', `SUMMARY:${title}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

/** A fetch that answers from a list in turn and records the links asked for. */
function fetches(...answers: Array<string | Error>) {
  const calls: string[] = [];

  const fetchLink = async (url: string): Promise<string> => {
    calls.push(url);
    const answer = answers.shift() ?? new Error('no answer');

    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  };

  return { calls, fetchLink };
}

function fakeStorage(): FeedStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();

  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** The titles a run serves. */
async function titles(feed: Feed, refreshMinutes: number, nowMs: number, fetchLink: (url: string) => Promise<string>, storage: FeedStorage): Promise<string[]> {
  return (await feedEvents(feed, refreshMinutes, nowMs, fetchLink, storage)).map((event) => event.title);
}

describe('feedEvents', () => {
  /** Fetching on every run spends the wearer's data on a feed that has not had time to change. */
  test('serves a copy younger than the Refresh Interval without fetching', async () => {
    const storage = fakeStorage();
    const { calls, fetchLink } = fetches(calendarOf('Standup'), calendarOf('Retro'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = await titles(FEED, 30, NOW_MS + 20 * MINUTE_MS, fetchLink, storage);

    expect([result, calls.length]).toEqual([['Standup'], 1]);
  });

  /** Runs come five minutes apart and can land a little early, and a 5 minute interval still has to fetch on each one. */
  test('fetches again on a run that lands a little before the Refresh Interval', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'), calendarOf('Retro'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = await titles(FEED, 30, NOW_MS + 29.5 * MINUTE_MS, fetchLink, storage);

    expect(result).toEqual(['Retro']);
  });

  /** A copy walked to last night's end of the week has nothing for the day the week gained at midnight. */
  test('fetches again once midnight has passed since the copy', async () => {
    // 23:50 on Wednesday 4 November in Toronto, then 00:05 on the Thursday
    const storage = fakeStorage();
    const { calls, fetchLink } = fetches(calendarOf('Standup'), calendarOf('Retro'));

    await feedEvents(FEED, 60, Date.UTC(2026, 10, 5, 4, 50), fetchLink, storage);

    const result = await titles(FEED, 60, Date.UTC(2026, 10, 5, 5, 5), fetchLink, storage);

    expect([result, calls.length]).toEqual([['Retro'], 2]);
  });

  /** A copy left behind a cleared link is what a locked keystore would serve, bringing back a calendar the wearer removed. */
  test('drops the copy when the link is cleared', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = await titles({ ...FEED, url: '' }, 30, NOW_MS + MINUTE_MS, fetchLink, storage);

    expect([result, storage.items.has(copyKey(1))]).toEqual([[], false]);
  });

  /** A locked keystore hides the link for a while, and the feed's events must not drop off the agenda meanwhile. */
  test('serves the copy without fetching when the link could not be read', async () => {
    const storage = fakeStorage();
    const { calls, fetchLink } = fetches(calendarOf('Standup'));

    await feedEvents(FEED, 5, NOW_MS, fetchLink, storage);

    const result = await titles({ ...FEED, url: null }, 5, NOW_MS + 60 * MINUTE_MS, fetchLink, storage);

    expect([result, calls.length]).toEqual([['Standup'], 1]);
  });

  /** A feed that is down for a run must not empty the agenda, and must be tried again on the next run. */
  test('keeps the last good copy through a failed fetch and tries again next run', async () => {
    const storage = fakeStorage();
    const { calls, fetchLink } = fetches(calendarOf('Standup'), new Error('HTTP 503'), calendarOf('Retro'));

    await feedEvents(FEED, 5, NOW_MS, fetchLink, storage);

    const failed = await titles(FEED, 5, NOW_MS + 5 * MINUTE_MS, fetchLink, storage);
    const next = await titles(FEED, 5, NOW_MS + 10 * MINUTE_MS, fetchLink, storage);

    expect([failed, next, calls.length]).toEqual([['Standup'], ['Retro'], 3]);
  });

  /** An error page is not a calendar with nothing on, so it keeps the copy rather than clearing the agenda. */
  test('keeps the last good copy when the answer is not iCal', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'), '<html>Sign in</html>');

    await feedEvents(FEED, 5, NOW_MS, fetchLink, storage);

    const result = await titles(FEED, 5, NOW_MS + 5 * MINUTE_MS, fetchLink, storage);

    expect(result).toEqual(['Standup']);
  });

  /** The old link's events served under a new link would show a calendar the wearer swapped out. */
  test('drops the copy when the link changes, even when the new link fails', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'), new Error('HTTP 404'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = await titles({ ...FEED, url: 'https://example.com/home.ics' }, 30, NOW_MS + MINUTE_MS, fetchLink, storage);

    expect([result, storage.items.has(copyKey(1))]).toEqual([[], false]);
  });

  /** A feed switched off has to leave the agenda at once, not when its copy runs out. */
  test('drops the copy when the feed is turned off', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = await titles({ ...FEED, on: false }, 30, NOW_MS + MINUTE_MS, fetchLink, storage);

    expect([result, storage.items.has(copyKey(1))]).toEqual([[], false]);
  });

  /** The link is the secret, so the plain storage the copy sits in must never hold it. */
  test('keeps the copy without the link', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    expect(storage.items.get(copyKey(1))).not.toContain('example.com/work.ics');
  });

  /** The link is a secret, and a runtime's fetch error can carry it into the log the wearer may share. */
  test('logs a failed fetch without its link', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { fetchLink } = fetches(new TypeError('Failed to fetch https://example.com/work.ics?token=secret'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, fakeStorage());

    expect(logged.mock.calls.map((call) => String(call[0]))).toEqual(['Calendar + iCal: feed 1 could not be fetched, TypeError']);
    logged.mockRestore();
  });

  /** A Subscribe link starts webcal:// or webcals://, and a pasted link can lose its scheme, none of which fetch takes. */
  test.each(['webcal://example.com/work.ics', 'webcals://example.com/work.ics', 'example.com/work.ics'])('fetches %s over https with a cache stamp', async (url) => {
    const { calls, fetchLink } = fetches(calendarOf('Standup'));

    await feedEvents({ ...FEED, url }, 30, NOW_MS, fetchLink, fakeStorage());

    expect(calls).toEqual([`https://example.com/work.ics?_=${NOW_MS}`]);
  });

  /** A face shows the calendar an event came from, and a feed's is the name the wearer gave it. */
  test("gives each event the feed's name as its calendar, renamed without a fetch", async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = await feedEvents({ ...FEED, name: 'Office' }, 30, NOW_MS + MINUTE_MS, fetchLink, storage);

    expect(result.map((event) => event.calendar)).toEqual(['Office']);
  });
});
