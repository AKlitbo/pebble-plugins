/**
 * Specs for fetching and keeping Calendar Enhanced + iCal's feeds.
 *
 * The plugin runs every five minutes with no memory but storage, so whether a feed is fetched is
 * decided from its kept copy. Fetching too often spends the wearer's data on a feed that has not
 * changed, and a failed fetch that wipes the copy empties the agenda until the feed comes back. A copy
 * kept across a changed link would serve the old calendar's events under the new one, and one kept
 * across changed email addresses would mark the wrong events declined.
 *
 * The status the settings page shows has to be for the link the feed has now, has to clear its failure
 * once the feed works again, and must never hold the runtime's own error text, which can carry the link.
 * A slow failure must not land over a newer run's good fetch, and a copy or status 1.2.0 kept under the
 * old stamp still has to match its link.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in Toronto, and every event is the next day.
 */

import { describe, test, expect, vi } from 'vitest';
import { copyKey, feedEvents, feedStatus, statusKey } from './feeds';
import type { Feed, FeedStorage } from './feeds';

// Wednesday 4 November 2026, 12:00 in Toronto
const NOW_MS = Date.UTC(2026, 10, 4, 17);

const MINUTE_MS = 60 * 1000;

// the stamp 1.2.0 kept for FEED's link
const OLD_STAMP = fnv('https://example.com/work.ics');

const FEED: Feed = { slot: 1, on: true, name: 'Work', url: 'https://example.com/work.ics' };

/** A feed of one timed event, Thursday 5 November 2026 at 15:00 UTC. */
function calendarOf(title: string): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${title}@example.com`, 'DTSTART:20261105T150000Z', 'DTEND:20261105T160000Z', `SUMMARY:${title}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

/** A feed of one meeting Thursday 5 November 2026 at 15:00 UTC, which me@example.com has declined. */
function declinedBy(title: string): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${title}@example.com`, 'DTSTART:20261105T150000Z', 'DTEND:20261105T160000Z', `SUMMARY:${title}`, 'ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

/** The FNV-1a hash in hex, the stamp 1.2.0 kept for a link, worked out here so the spec states the old form itself. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }

  return hash.toString(16);
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
  test('serves a copy younger than the iCal Refresh Interval without fetching', async () => {
    const storage = fakeStorage();
    const { calls, fetchLink } = fetches(calendarOf('Standup'), calendarOf('Retro'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = await titles(FEED, 30, NOW_MS + 20 * MINUTE_MS, fetchLink, storage);

    expect([result, calls.length]).toEqual([['Standup'], 1]);
  });

  /** Runs come five minutes apart and can land a little early, and a 5 minute interval still has to fetch on each one. */
  test('fetches again on a run that lands a little before the iCal Refresh Interval', async () => {
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

  /** A copy read for a week, served after the wearer picks a month, leaves the new weeks empty until the next refresh. */
  test('fetches again when the Look Ahead changes', async () => {
    const storage = fakeStorage();
    const { calls, fetchLink } = fetches(calendarOf('Standup'), calendarOf('Retro'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage, 7);

    const result = (await feedEvents(FEED, 30, NOW_MS + MINUTE_MS, fetchLink, storage, 31)).map((event) => event.title);

    expect([result, calls.length]).toEqual([['Retro'], 2]);
  });

  /** A copy saved before the Look Ahead existed was read for the week, so the first run after the update must serve it rather than fetch every feed at once. */
  test('serves a copy with no Look Ahead as the week', async () => {
    const storage = fakeStorage();
    const { calls, fetchLink } = fetches(calendarOf('Standup'), calendarOf('Retro'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = (await feedEvents(FEED, 30, NOW_MS + MINUTE_MS, fetchLink, storage, 7)).map((event) => event.title);

    expect([result, calls.length]).toEqual([['Standup'], 1]);
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

    expect(logged.mock.calls.map((call) => String(call[0]))).toEqual(['Calendar Enhanced + iCal: feed 1 could not be fetched, FAILED']);
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

  /** The wearer's own answer is only found by their address, so without it Hide Declined Events has nothing to go on. */
  test("marks an event declined by one of the wearer's addresses", async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(declinedBy('Offsite'));

    const result = await feedEvents({ ...FEED, addresses: ['Me@Example.com'] }, 30, NOW_MS, fetchLink, storage);

    expect(result.map((event) => [event.title, event.declined])).toEqual([['Offsite', true]]);
  });

  /** A copy read for no address marks nothing declined, so a wearer who adds theirs would see no change until the next refresh. */
  test('fetches again when the email addresses change', async () => {
    const storage = fakeStorage();
    const { calls, fetchLink } = fetches(declinedBy('Offsite'), declinedBy('Offsite'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = await feedEvents({ ...FEED, addresses: ['me@example.com'] }, 30, NOW_MS + MINUTE_MS, fetchLink, storage);

    expect([result.map((event) => event.declined), calls.length]).toEqual([[true], 2]);
  });

  /** The same addresses typed in another case or order mark the same events, so fetching again only spends the wearer's data. */
  test('serves the copy for the same addresses in another case and order', async () => {
    const storage = fakeStorage();
    const { calls, fetchLink } = fetches(declinedBy('Offsite'), declinedBy('Offsite'));

    await feedEvents({ ...FEED, addresses: ['me@example.com', 'work@example.com'] }, 30, NOW_MS, fetchLink, storage);

    await feedEvents({ ...FEED, addresses: ['WORK@example.com', ' me@example.com'] }, 30, NOW_MS + MINUTE_MS, fetchLink, storage);

    expect(calls.length).toBe(1);
  });
});

describe('feedStatus', () => {
  /** The settings page shows this, and a wrong time or count tells the wearer a working feed is stuck. */
  test('gives the time and the count of the last good fetch', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = feedStatus(FEED, storage);

    expect(result).toEqual({ fetchedMs: NOW_MS, events: 1 });
  });

  /** A wearer whose feed stopped working has to see why beside when it last worked. */
  test("keeps a failure's kind beside the last good fetch", async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'), new Error('HTTP 503'));

    await feedEvents(FEED, 5, NOW_MS, fetchLink, storage);
    await feedEvents(FEED, 5, NOW_MS + 5 * MINUTE_MS, fetchLink, storage);

    const result = feedStatus(FEED, storage);

    expect(result).toEqual({ fetchedMs: NOW_MS, events: 1, error: 'HTTP 503', errorMs: NOW_MS + 5 * MINUTE_MS });
  });

  /** A sign-in page in place of the calendar is the usual way a private link goes bad, and it has to read as that. */
  test('gives NOT_ICAL for an answer that is not iCal', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches('<html>Sign in</html>');

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = feedStatus(FEED, storage);

    expect(result).toEqual({ error: 'NOT_ICAL', errorMs: NOW_MS });
  });

  /** The runtime's own error text can carry the link, which works like a password and must never reach plain storage. */
  test.each([
    ['fetch timeout: https://example.com/work.ics?token=secret', 'TypeError', 'TIMEOUT'],
    ['fetch failed: https://example.com/work.ics?token=secret', 'TypeError', 'FAILED'],
    ['https://example.com/work.ics?token=secret is not allowed', 'NotAllowedError', 'NOT_ALLOWED'],
  ])("keeps %s as its kind, never the runtime's text", async (message, name, kind) => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(Object.assign(new Error(message), { name }));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = [feedStatus(FEED, storage), [...storage.items.values()].some((value) => value.includes('secret') || value.includes('example.com'))];

    expect(result).toEqual([{ error: kind, errorMs: NOW_MS }, false]);
  });

  /** A wearer's email addresses are theirs, and only a stamp of them is needed to tell a change. */
  test("never keeps the wearer's addresses", async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(declinedBy('Offsite'));

    await feedEvents({ ...FEED, addresses: ['me@example.com'] }, 30, NOW_MS, fetchLink, storage);

    const result = [...storage.items.values()].some((value) => value.includes('me@example'));

    expect(result).toBe(false);
  });

  /** A failure for a new link standing beside the old link's fetch would say the new link once worked. */
  test("gives a new link none of the old link's status", async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'), new Error('HTTP 404'));
    const moved = { ...FEED, url: 'https://example.com/home.ics' };

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);
    await feedEvents(moved, 30, NOW_MS + MINUTE_MS, fetchLink, storage);

    const result = feedStatus(moved, storage);

    expect(result).toEqual({ error: 'HTTP 404', errorMs: NOW_MS + MINUTE_MS });
  });

  /** A copy kept with no status beside it was still fetched, and its failure must not read as never fetched. */
  test('takes the fetch time and count from the kept copy when a fetch fails with no status kept', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'), new Error('HTTP 503'));

    await feedEvents(FEED, 5, NOW_MS, fetchLink, storage);
    storage.removeItem(statusKey(1));
    await feedEvents(FEED, 5, NOW_MS + 5 * MINUTE_MS, fetchLink, storage);

    const result = feedStatus(FEED, storage);

    expect(result).toEqual({ fetchedMs: NOW_MS, events: 1, error: 'HTTP 503', errorMs: NOW_MS + 5 * MINUTE_MS });
  });

  /** A status saying fetched beside a copy that was never kept would tell the wearer a feed works when it serves nothing. */
  test('keeps no fetched status when the copy cannot be kept', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'));
    // a copy is far larger than a status, so it is the copy that runs out of room
    const full: FeedStorage = {
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem: (key, value) => {
        if (key === copyKey(1)) {
          throw new Error('QuotaExceededError');
        }

        storage.setItem(key, value);
      },
    };

    await feedEvents(FEED, 30, NOW_MS, fetchLink, full);

    const result = feedStatus(FEED, storage);

    expect(result).toBeNull();
  });

  /** A slow failed fetch finishing after a newer run's good one would put an old failure over a feed that works. */
  test("keeps a later run's good fetch over an earlier run's failure that finishes after it", async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'));
    let fail: (error: Error) => void = () => undefined;
    const earlier = feedEvents(FEED, 30, NOW_MS, () => new Promise<string>((resolve, reject) => void (fail = reject)), storage);

    await feedEvents(FEED, 30, NOW_MS + MINUTE_MS, fetchLink, storage);
    fail(new Error('HTTP 503'));
    await earlier;

    const result = feedStatus(FEED, storage);

    expect(result).toEqual({ fetchedMs: NOW_MS + MINUTE_MS, events: 1 });
  });

  /** A copy and a status kept by 1.2.0 carry the old stamp, and refusing them would refetch every feed the run after the update. */
  test('accepts a copy and a status with the old stamp of their link', async () => {
    const storage = fakeStorage();
    const { calls, fetchLink } = fetches(calendarOf('Retro'));
    const event = { startEpoch: Date.UTC(2026, 10, 5, 15) / 1000, endEpoch: Date.UTC(2026, 10, 5, 16) / 1000, allDay: false, title: 'Standup', location: '' };

    storage.setItem(copyKey(1), JSON.stringify({ link: OLD_STAMP, fetchedMs: NOW_MS, events: [event] }));
    storage.setItem(statusKey(1), JSON.stringify({ link: OLD_STAMP, fetchedMs: NOW_MS, events: 1 }));

    const result = [await titles(FEED, 30, NOW_MS + MINUTE_MS, fetchLink, storage), feedStatus(FEED, storage), calls.length];

    expect(result).toEqual([['Standup'], { fetchedMs: NOW_MS, events: 1 }, 0]);
  });

  /** A failure left showing after the feed came back would have the wearer chase a problem that has gone. */
  test('clears the failure on the next good fetch', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(new Error('HTTP 503'), calendarOf('Standup'));

    await feedEvents(FEED, 5, NOW_MS, fetchLink, storage);
    await feedEvents(FEED, 5, NOW_MS + 5 * MINUTE_MS, fetchLink, storage);

    const result = feedStatus(FEED, storage);

    expect(result).toEqual({ fetchedMs: NOW_MS + 5 * MINUTE_MS, events: 1 });
  });

  /** A status from the old link would tell the wearer their new link already works, or already failed. */
  test('gives nothing for a link changed since the fetch', async () => {
    const storage = fakeStorage();
    const { fetchLink } = fetches(calendarOf('Standup'));

    await feedEvents(FEED, 30, NOW_MS, fetchLink, storage);

    const result = feedStatus({ ...FEED, url: 'https://example.com/home.ics' }, storage);

    expect(result).toBeNull();
  });

  /** A copy kept before statuses existed was still fetched, and the page must not call the feed unfetched. */
  test("gives a kept copy's fetch time and count when no status is kept", () => {
    const storage = fakeStorage();
    const event = { startEpoch: 1, endEpoch: 2, allDay: false, title: 'Standup', location: '' };

    storage.setItem(copyKey(1), JSON.stringify({ link: 'not this one', fetchedMs: NOW_MS, events: [event] }));

    const result = [feedStatus({ ...FEED, url: null }, storage), feedStatus(FEED, storage)];

    expect(result).toEqual([{ fetchedMs: NOW_MS, events: 1 }, null]);
  });
});
