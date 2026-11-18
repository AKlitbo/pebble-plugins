/**
 * Specs for one run of Calendar Enhanced + iCal from end to end, against a stand-in for the Pebble
 * app's runtime and a stubbed fetch.
 *
 * Each part has its own spec. What is pinned here is that the settings the page saved reach the
 * parts, with the feed link coming from the encrypted storage, and that the answer the Pebble app gets
 * is the merged agenda. With everything off it has to be an empty list, since an error would leave a
 * face showing the last agenda it had.
 *
 * The Look Ahead is pinned here too, since the feeds' walk and the agenda's cut both have to take it.
 * A window that one of them misses ends a day early or late, or drops a recurring event's later weeks.
 *
 * So is the answer's expiry, with the filters it hangs on. The answer has to run out when the next
 * event in it ends or Hide Events in Progress takes it off, or a reader that honours the expiry keeps
 * a meeting that has gone for the rest of the five minutes. Settings saved before the filters existed
 * must serve the same agenda as before.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in Toronto.
 */

import { describe, test, expect } from 'vitest';
import type { PluginPebble, SourceResponder } from '../../paf/ts/plugin-app/runtime';
import { SETTINGS_KEY } from '../../paf/ts/plugin-app/settings';
import type { SourceEnvelope, SourceInstance } from '../../paf/ts/plugin-sources/types';
import { ANSWER_MS, handleSource } from './serve';

// Wednesday 4 November 2026, 12:00 in Toronto
const NOW_MS = Date.UTC(2026, 10, 4, 17);

const HOUR_MS = 60 * 60 * 1000;

/** The built-in's update, one meeting Thursday 5 November at 14:00 UTC in the Work calendar. */
const PHONE_UPDATE: SourceEnvelope = {
  instances: [
    {
      instanceId: '0',
      properties: {
        name: { shortText: { text: 'Dentist' }, longText: { text: 'Dentist' } },
        starts_at: { shortText: { text: '09:00' }, timestamp: { value: Date.UTC(2026, 10, 5, 14) / 1000 } },
        ends_at: { shortText: { text: '10:00' }, timestamp: { value: Date.UTC(2026, 10, 5, 15) / 1000 } },
        all_day: { boolean: { value: false } },
        calendar: { shortText: { text: 'Work' } },
      },
    },
  ],
};

/** A feed of one meeting, Thursday 5 November 2026 at 15:00 UTC. */
const FEED = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:standup@example.com', 'DTSTART:20261105T150000Z', 'DTEND:20261105T153000Z', 'SUMMARY:Standup', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

/** A feed of these events, each a title, its start and end as iCal writes them in UTC or as dates for an all-day one, and any rule. */
function feedOf(...events: Array<{ title: string; start: string; end: string; rule?: string; allDay?: boolean }>): string {
  const lines = events.flatMap(({ title, start, end, rule, allDay }) => {
    const shape = allDay ? ';VALUE=DATE' : '';

    return ['BEGIN:VEVENT', `UID:${title}@example.com`, `DTSTART${shape}:${start}`, `DTEND${shape}:${end}`, ...(rule ? [`RRULE:${rule}`] : []), `SUMMARY:${title}`, 'END:VEVENT'];
  });

  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');
}

/** A phone whose plain storage starts with these saved settings, kept across runs. */
function phoneWith(saved: Record<string, unknown>) {
  const items = new Map<string, string>([[SETTINGS_KEY, JSON.stringify(saved)]]);

  return {
    storage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) },
    fetched: [] as string[],
    subscribed: 0,
  };
}

/** Runs the source handler once at a moment, with these secrets or a keystore that cannot be read, and gives back its answer. */
async function run(phone: ReturnType<typeof phoneWith>, secrets: Record<string, string> | 'locked', nowMs = NOW_MS, feed = FEED) {
  let handler: ((request: unknown, respond: SourceResponder) => void | Promise<void>) | null = null;
  const pebble = {
    registerSourceHandler: (registered: typeof handler) => void (handler = registered),
    subscribeSource: () => void phone.subscribed++,
    readSource: async () => PHONE_UPDATE,
    secureStorage: {
      getItem: async (key: string) => {
        if (secrets === 'locked') {
          throw new Error('keystore locked');
        }

        return secrets[key] ?? null;
      },
    },
  } as unknown as PluginPebble;
  const answers: Array<{ validUntilMs?: number; instances: SourceInstance[] } | string> = [];

  handleSource({ pebble, storage: phone.storage, fetchLink: async (url) => (phone.fetched.push(url), feed) }, () => nowMs);
  await handler!({ category: 'calendar', item: 'event' }, { data: (envelope) => void answers.push(envelope), error: (code) => void answers.push(code) });

  return answers;
}

/** What each served instance shows, its title and calendar, as a face would show them. */
function shown(answers: Awaited<ReturnType<typeof run>>): string[] {
  const answer = answers[0] as { instances: SourceInstance[] };

  return answer.instances.map((instance) => `${instance.properties?.name?.longText?.text} (${instance.properties?.calendar?.longText?.text})`);
}

/** How long the answer is good for, in milliseconds past the usual now. */
function lasts(answers: Awaited<ReturnType<typeof run>>): number {
  return (answers[0] as { validUntilMs: number }).validUntilMs - NOW_MS;
}

/** When each served instance starts, in UTC. */
function starts(answers: Awaited<ReturnType<typeof run>>): string[] {
  const answer = answers[0] as { instances: SourceInstance[] };

  return answer.instances.map((instance) => new Date(Number(instance.properties?.starts_at?.timestamp?.value) * 1000).toISOString());
}

const TEAM_LINK = { FEED1_URL: 'https://example.com/team.ics' };

describe('handleSource', () => {
  /** The whole point of the plugin: the phone's meeting and the feed's, merged, each named for where it came from. */
  test("serves the phone's events and a feed's together, soonest first", async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true, FEED1_ON: true, FEED1_NAME: 'Team' });

    const answers = await run(phone, { FEED1_URL: 'https://example.com/team.ics' });

    expect([shown(answers), (answers[0] as { validUntilMs: number }).validUntilMs, phone.fetched.length]).toEqual([['Dentist (Work)', 'Standup (Team)'], NOW_MS + ANSWER_MS, 1]);
  });

  /** An error leaves a face on the last agenda it had, and a subscription would keep waking the plugin on every phone calendar change. */
  test('answers an empty agenda with everything off, without subscribing to the phone', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false });

    const answers = await run(phone, { FEED1_URL: 'https://example.com/team.ics' });

    expect([answers, phone.fetched.length, phone.subscribed]).toEqual([[{ validUntilMs: NOW_MS + ANSWER_MS, instances: [] }], 0, 0]);
  });

  /** A locked keystore reads the link as empty, which must not take the feed's events off the agenda. */
  test("serves a feed's kept copy while its link cannot be read", async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team' });

    await run(phone, { FEED1_URL: 'https://example.com/team.ics' });

    const answers = await run(phone, 'locked', NOW_MS + HOUR_MS);

    expect([shown(answers), phone.fetched.length]).toEqual([['Standup (Team)'], 1]);
  });
});

describe('the Look Ahead', () => {
  /** A Today that runs past midnight shows tomorrow's breakfast among tonight's plans. */
  test('ends Today at midnight on the phone', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', LOOK_AHEAD: '1' });
    // 23:30 on Wednesday in Toronto, and 00:30 on Thursday
    const feed = feedOf({ title: 'Late Call', start: '20261105T043000Z', end: '20261105T045000Z' }, { title: 'Breakfast', start: '20261105T053000Z', end: '20261105T063000Z' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, feed);

    expect(shown(answers)).toEqual(['Late Call (Team)']);
  });

  /** A walk that stops at the week leaves a weekly meeting off the second week the wearer asked for. */
  test("gives a weekly meeting's second week with 2 Weeks", async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', LOOK_AHEAD: '14' });
    const feed = feedOf({ title: 'Standup', start: '20261105T150000Z', end: '20261105T153000Z', rule: 'FREQ=WEEKLY' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, feed);

    expect(starts(answers)).toEqual(['2026-11-05T15:00:00.000Z', '2026-11-12T15:00:00.000Z']);
  });

  /** A month is today and the next 30 days, so its last evening is in and the morning after is not. */
  test('reaches day 31 with 1 Month', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', LOOK_AHEAD: '31' });
    // 20:00 on Friday 4 December in Toronto, and 09:00 on Saturday 5 December
    const feed = feedOf({ title: 'Last Day', start: '20261205T010000Z', end: '20261205T020000Z' }, { title: 'Past It', start: '20261205T140000Z', end: '20261205T150000Z' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, feed);

    expect(shown(answers)).toEqual(['Last Day (Team)']);
  });

  /** A free day under Today has to read as nothing on, not as tomorrow's first meeting. */
  test('sends no events for Today with nothing on today', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true, FEED1_ON: true, FEED1_NAME: 'Team', LOOK_AHEAD: '1' });

    const answers = await run(phone, TEAM_LINK);

    expect(answers).toEqual([{ validUntilMs: NOW_MS + ANSWER_MS, instances: [] }]);
  });
});

describe('the filters', () => {
  const MINUTE_MS = 60 * 1000;
  // 11:47 on Wednesday in Toronto, 13 minutes before now, and Thursday's standup
  const DAY = feedOf({ title: 'Planning', start: '20261104T164700Z', end: '20261104T174700Z' }, { title: 'Standup', start: '20261105T150000Z', end: '20261105T153000Z' });
  // all of Wednesday 4 November
  const WITH_ALL_DAY = feedOf({ title: 'Out of Office', start: '20261104', end: '20261105', allDay: true }, { title: 'Standup', start: '20261105T150000Z', end: '20261105T153000Z' });

  /** A meeting due to leave two minutes from now would be promised for the other three without the earlier expiry. */
  test('runs the answer out when the next event is due to leave', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', HIDE_STARTED: '15' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, DAY);

    expect([shown(answers), lasts(answers)]).toEqual([['Planning (Team)', 'Standup (Team)'], 2 * MINUTE_MS]);
  });

  /** A run at the moment that answer runs out has to drop the meeting, or the expiry promised something the next answer breaks. */
  test('drops the event on the run at the moment the answer ran out', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', HIDE_STARTED: '15' });

    const answers = await run(phone, TEAM_LINK, NOW_MS + 2 * MINUTE_MS, DAY);

    expect(shown(answers)).toEqual(['Standup (Team)']);
  });

  /** A meeting that ends before its cutoff is gone at its end, and an answer kept to the cutoff would show it for eight more minutes. */
  test('runs the answer out when a meeting ends before its cutoff', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', HIDE_STARTED: '60' });
    // 11:10 to 12:02 on Wednesday in Toronto, so its cutoff at 12:10 comes after it ends
    const feed = feedOf({ title: 'Review', start: '20261104T161000Z', end: '20261104T170200Z' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, feed);

    expect([shown(answers), lasts(answers)]).toEqual([['Review (Team)'], 2 * MINUTE_MS + 1000]);
  });

  /** Never only keeps a meeting until it ends, so the answer must not promise it for the rest of the five minutes. */
  test('runs the answer out when a meeting ends with Never', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', HIDE_STARTED: 'never' });
    // 11:30 to 12:02 on Wednesday in Toronto
    const feed = feedOf({ title: 'Review', start: '20261104T163000Z', end: '20261104T170200Z' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, feed);

    expect([shown(answers), lasts(answers)]).toEqual([['Review (Team)'], 2 * MINUTE_MS + 1000]);
  });

  /** An event that leaves after the next run anyway has no reason to bring that run forward. */
  test('keeps the full gap when nothing leaves inside it', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', HIDE_STARTED: '30' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, DAY);

    expect(lasts(answers)).toBe(ANSWER_MS);
  });

  /** The switch has to reach the agenda from the saved settings, or the wearer's all-day reminders stay. */
  test('serves no all-day events with Show All-Day Events off', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', ALL_DAY_EVENTS: false });

    const answers = await run(phone, TEAM_LINK, NOW_MS, WITH_ALL_DAY);

    expect(shown(answers)).toEqual(['Standup (Team)']);
  });

  /** A wearer updating from 1.1.0 has no filters saved, and must see the same agenda for the same five minutes. */
  test('serves the meeting in progress and the all-day event from settings saved without the filters', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team' });
    const feed = feedOf({ title: 'Out of Office', start: '20261104', end: '20261105', allDay: true }, { title: 'Planning', start: '20261104T164700Z', end: '20261104T174700Z' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, feed);

    expect([shown(answers), lasts(answers)]).toEqual([['Out of Office (Team)', 'Planning (Team)'], ANSWER_MS]);
  });
});
