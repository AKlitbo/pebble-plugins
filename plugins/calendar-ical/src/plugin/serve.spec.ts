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
 * must serve the same agenda as before. The same holds for the switches that hide a feed's declined,
 * tentative, and free events, and for Time Labels, which must keep the built-in's text until the
 * wearer picks Short Labels.
 *
 * The phone's last good read has to serve through a slow read and go when Show Phone Calendars does.
 * No answer may outlast the phone's next midnight. A phone calendar switched off has to stay off
 * the agenda without taking a feed's copy of the same event with it.
 *
 * A Public Holidays feed has to fetch its country's link, never the secret link saved beside it, and
 * a feed saved without a Source has to keep fetching its iCal link.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in Toronto.
 */

import { describe, test, expect } from 'vitest';
import type { PluginPebble, SourceRequest, SourceResponder } from '../../paf/ts/plugin-app/runtime';
import { SETTINGS_KEY } from '../../paf/ts/plugin-app/settings';
import type { SourceEnvelope, SourceInstance } from '../../paf/ts/plugin-sources/types';
import type { TimelinePin } from '../../paf/ts/plugin-app/timeline';
import { ANSWER_MS, agendaLimit, handleSource } from './serve';

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

/** A feed of these events, each a title, its start and end as iCal writes them in UTC or as dates for an all-day one, any rule, and any more lines. */
function feedOf(...events: Array<{ title: string; start: string; end: string; rule?: string; allDay?: boolean; more?: string[] }>): string {
  const lines = events.flatMap(({ title, start, end, rule, allDay, more = [] }) => {
    const shape = allDay ? ';VALUE=DATE' : '';

    return ['BEGIN:VEVENT', `UID:${title}@example.com`, `DTSTART${shape}:${start}`, `DTEND${shape}:${end}`, ...(rule ? [`RRULE:${rule}`] : []), `SUMMARY:${title}`, ...more, 'END:VEVENT'];
  });

  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');
}

/** A moment as iCal writes it in UTC, such as 20261105T150000Z. */
function icalTime(ms: number): string {
  return `${new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/**
 * A phone whose plain storage starts with these saved settings, kept across runs. The built-in
 * calendar answers `PHONE_UPDATE` and the Preferences plugin refuses, until a spec sets either answer.
 */
function phoneWith(saved: Record<string, unknown>) {
  const items = new Map<string, string>([[SETTINGS_KEY, JSON.stringify(saved)]]);

  return {
    storage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) },
    fetched: [] as string[],
    subscribed: 0,
    calendar: PHONE_UPDATE as SourceEnvelope | Error,
    preferences: Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' }) as SourceEnvelope | Error,
    preferencesRead: 0,
    pins: new Map<string, TimelinePin>(),
    pinsAtAnswer: -1,
  };
}

/** The answer a fake source gives, or its refusal. */
async function answerOf(answer: SourceEnvelope | Error): Promise<SourceEnvelope> {
  if (answer instanceof Error) {
    throw answer;
  }

  return answer;
}

/** Runs the source handler once at a moment, with these secrets or a keystore that cannot be read, and gives back its answer. */
async function run(phone: ReturnType<typeof phoneWith>, secrets: Record<string, string> | 'locked', nowMs = NOW_MS, feed = FEED, request: Record<string, unknown> = { category: 'calendar', item: 'event' }) {
  let handler: ((request: unknown, respond: SourceResponder) => void | Promise<void>) | null = null;
  const pebble = {
    registerSourceHandler: (registered: typeof handler) => void (handler = registered),
    subscribeSource: () => void phone.subscribed++,
    readSource: (asked: SourceRequest) => {
      if (asked.category === 'preferences') {
        phone.preferencesRead++;

        return answerOf(phone.preferences);
      }

      return answerOf(phone.calendar);
    },
    insertTimelinePin: (pin: TimelinePin) => void phone.pins.set(pin.id, pin),
    deleteTimelinePin: (id: string) => void phone.pins.delete(id),
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
  await handler!(request, {
    data: (envelope) => {
      phone.pinsAtAnswer = phone.pins.size;
      answers.push(envelope);
    },
    error: (code) => void answers.push(code),
  });

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
    const result = shown(answers);

    expect(result).toEqual(['Late Call (Team)']);
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
    const result = shown(answers);

    expect(result).toEqual(['Last Day (Team)']);
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
    const result = shown(answers);

    expect(result).toEqual(['Standup (Team)']);
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
    const result = shown(answers);

    expect(result).toEqual(['Standup (Team)']);
  });

  /** A wearer updating from 1.1.0 has no filters saved, and must see the same agenda for the same five minutes. */
  test('serves the meeting in progress and the all-day event from settings saved without the filters', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team' });
    const feed = feedOf({ title: 'Out of Office', start: '20261104', end: '20261105', allDay: true }, { title: 'Planning', start: '20261104T164700Z', end: '20261104T174700Z' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, feed);

    expect([shown(answers), lasts(answers)]).toEqual([['Out of Office (Team)', 'Planning (Team)'], ANSWER_MS]);
  });
});

describe('agendaLimit', () => {
  /** A reader that asks for a number inside the range has to get that many, or a busy week still stops short. */
  test.each([
    [1, 1],
    [50, 50],
    [200, 200],
    [7.9, 7],
  ])('reads a limit of %s as %s', (limit, events) => {
    const result = agendaLimit(limit);

    expect(result).toBe(events);
  });

  /** A number past either end would serve an empty agenda or more than the Pebble app takes in one answer. */
  test.each([
    [0, 1],
    [-5, 1],
    [201, 200],
    [10000, 200],
  ])('holds a limit of %s to %s', (limit, events) => {
    const result = agendaLimit(limit);

    expect(result).toBe(events);
  });

  /** A reader that names no number has to keep the 20 events it always had. */
  test.each([undefined, null, '30', NaN, Infinity])('reads a limit of %s as 20', (limit) => {
    const result = agendaLimit(limit);

    expect(result).toBe(20);
  });
});

describe('the limit', () => {
  // 25 half-hour meetings an hour apart from 13:00 on Thursday 5 November in Toronto
  const BUSY = feedOf(...Array.from({ length: 25 }, (_, index) => ({ title: `Meeting ${index + 1}`, start: icalTime(Date.UTC(2026, 10, 5, 18) + index * HOUR_MS), end: icalTime(Date.UTC(2026, 10, 5, 18, 30) + index * HOUR_MS) })));

  /** A face that asks for more than 20 has to get them, or a busy week still stops at 20. */
  test('serves as many events as the reader asks for', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, BUSY, { category: 'calendar', item: 'event', limit: 22 });
    const result = shown(answers).length;

    expect(result).toBe(22);
  });

  /** A face that asks for no number has to keep the 20 it always had. */
  test('serves 20 events to a reader that names no number', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, BUSY);
    const result = shown(answers).length;

    expect(result).toBe(20);
  });

  /** A feed read for the iCal reader's own 64 would stop a busy feed short of what a face asked for. */
  test('serves more than 64 events from one feed to a reader that asks for them', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team' });
    // 80 half-hour meetings an hour apart from 13:00 on Thursday 5 November in Toronto
    const feed = feedOf(...Array.from({ length: 80 }, (_, index) => ({ title: `Meeting ${index + 1}`, start: icalTime(Date.UTC(2026, 10, 5, 18) + index * HOUR_MS), end: icalTime(Date.UTC(2026, 10, 5, 18, 30) + index * HOUR_MS) })));

    const answers = await run(phone, TEAM_LINK, NOW_MS, feed, { category: 'calendar', item: 'event', limit: 100 });
    const result = shown(answers).length;

    expect(result).toBe(80);
  });
});

describe('the notes', () => {
  /** A feed event's notes have to reach a face the way the built-in sends a phone event's. */
  test("serves a feed event's notes", async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team' });
    const feed = FEED.replace('SUMMARY:Standup', 'SUMMARY:Standup\r\nDESCRIPTION:Dial in from the car');

    const answers = await run(phone, TEAM_LINK, NOW_MS, feed);

    expect((answers[0] as { instances: SourceInstance[] }).instances[0].properties?.description).toEqual({ longText: { text: 'Dial in from the car' } });
  });
});

describe('the marks', () => {
  // Thursday's standup, an offsite me@example.com declined, a tentative lunch, and a free hold
  const MARKED = feedOf(
    { title: 'Standup', start: '20261105T150000Z', end: '20261105T153000Z' },
    { title: 'Offsite', start: '20261105T160000Z', end: '20261105T170000Z', more: ['ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com'] },
    { title: 'Lunch', start: '20261105T170000Z', end: '20261105T180000Z', more: ['STATUS:TENTATIVE'] },
    { title: 'Hold', start: '20261105T190000Z', end: '20261105T200000Z', more: ['TRANSP:TRANSPARENT'] }
  );

  /** The switches and the addresses have to reach the agenda from the saved settings, or the wearer's declined meetings stay. */
  test('hides the declined, tentative, and free events with their switches on', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', HIDE_DECLINED: true, EMAIL_ADDRESSES: 'me@example.com', HIDE_TENTATIVE: true, HIDE_FREE: true });

    const answers = await run(phone, TEAM_LINK, NOW_MS, MARKED);
    const result = shown(answers);

    expect(result).toEqual(['Standup (Team)']);
  });

  /** A wearer updating from 1.2.0 has none of the switches saved, and must see every event they saw before. */
  test('serves every event from settings saved without the switches', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', EMAIL_ADDRESSES: 'me@example.com' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, MARKED);
    const result = shown(answers);

    expect(result).toEqual(['Standup (Team)', 'Offsite (Team)', 'Lunch (Team)', 'Hold (Team)']);
  });
});

describe('Time Labels', () => {
  // 10:00 on Wednesday 4 November in Toronto, two hours before now, still running, and Thursday's standup at 10:00
  const TWO = feedOf({ title: 'Review', start: '20261104T150000Z', end: '20261104T180000Z' }, { title: 'Standup', start: '20261105T150000Z', end: '20261105T153000Z' });

  /** The labels a face reads as text for each served start, its short one and its long one. */
  function labels(answers: Awaited<ReturnType<typeof run>>): string[][] {
    const answer = answers[0] as { instances: SourceInstance[] };

    return answer.instances.map((instance) => [String(instance.properties?.starts_at?.shortText?.text), String(instance.properties?.starts_at?.longText?.text)]);
  }

  /** A wearer switching from the built-in must see the same text until they pick otherwise, with no extra read on each run. */
  test("serves the built-in's HH:MM from settings saved without Time Labels", async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, TWO);

    expect([labels(answers), phone.preferencesRead]).toEqual([
      [
        ['10:00', '10:00'],
        ['10:00', '10:00'],
      ],
      0,
    ]);
  });

  /** Short Labels have to follow the wearer's own clock and name tomorrow, or a 12-hour wearer reads 14:30 for every day. */
  test("serves Short Labels on the wearer's 12-hour clock", async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', TIME_LABELS: 'short' });

    phone.preferences = { instances: [{ instanceId: 'units', properties: { clock: { shortText: { text: '12h' } }, locale: { shortText: { text: 'en-US' } } } }] };

    const answers = await run(phone, TEAM_LINK, NOW_MS, TWO);

    expect(labels(answers)).toEqual([
      ['10:00a', '10:00a'],
      ['Thu', 'Thu 10:00a'],
    ]);
  });

  /** A refused read of the wearer's preferences must still serve the agenda, on the 24-hour clock in English. */
  test('serves Short Labels in English on the 24-hour clock when the preferences cannot be read', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', TIME_LABELS: 'short' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, TWO);

    expect(labels(answers)).toEqual([
      ['10:00', '10:00'],
      ['Thu', 'Thu 10:00'],
    ]);
  });
});

describe("the phone's last good read", () => {
  const TIMEOUT = Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' });

  /** One slow read of the phone would empty the phone's part of the agenda on every face until the next run. */
  test('serves the last good read when a read times out', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true });

    await run(phone, {});

    phone.calendar = TIMEOUT;

    const answers = await run(phone, {}, NOW_MS + 5 * 60 * 1000);
    const result = shown(answers);

    expect(result).toEqual(['Dentist (Work)']);
  });

  /** A read kept through Show Phone Calendars going off would bring old events back the moment it goes on again. */
  test('drops the last good read when Show Phone Calendars goes off', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true });

    await run(phone, {});
    phone.storage.setItem(SETTINGS_KEY, JSON.stringify({ PHONE_CALENDARS: false }));
    await run(phone, {});
    phone.storage.setItem(SETTINGS_KEY, JSON.stringify({ PHONE_CALENDARS: true }));
    phone.calendar = TIMEOUT;

    const answers = await run(phone, {});
    const result = shown(answers);

    expect(result).toEqual([]);
  });
});

describe('midnight', () => {
  /** The window gains a day at midnight and tomorrow's labels turn into today's, so an answer that outlasts it shows yesterday's agenda. */
  test('runs the answer out at the phone\'s next midnight', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false });
    // 23:58 on Wednesday 4 November in Toronto
    const lateMs = Date.UTC(2026, 10, 5, 4, 58);

    const answers = await run(phone, {}, lateMs);
    const result = (answers[0] as { validUntilMs: number }).validUntilMs;

    expect(result).toBe(Date.UTC(2026, 10, 5, 5));
  });
});

describe('Hide Events Titled from the settings', () => {
  // Thursday's team lunch and standup
  const LUNCH = feedOf({ title: 'Team Lunch', start: '20261105T170000Z', end: '20261105T180000Z' }, { title: 'Standup', start: '20261105T150000Z', end: '20261105T153000Z' });

  /** The box has to reach the agenda from the saved settings as a comma list, for the phone's events and a feed's. */
  test('hides the events whose titles match the saved words', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true, FEED1_ON: true, FEED1_NAME: 'Team', HIDE_TITLED: 'dentist, Lunch' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, LUNCH);
    const result = shown(answers);

    expect(result).toEqual(['Standup (Team)']);
  });

  /** A wearer updating with no words saved must keep every event. */
  test('serves every event from settings saved without the box', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true, FEED1_ON: true, FEED1_NAME: 'Team' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, LUNCH);
    const result = shown(answers);

    expect(result).toEqual(['Dentist (Work)', 'Standup (Team)', 'Team Lunch (Team)']);
  });
});

describe('the phone calendars switched off', () => {
  // the dentist appointment the Work calendar holds, as a feed holds it too
  const DENTIST = feedOf({ title: 'Dentist', start: '20261105T140000Z', end: '20261105T150000Z' });

  /** A calendar switched off on the page has to keep its events off the watch. */
  test("keeps a switched off calendar's events off the agenda", async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true, HIDDEN_CALENDARS: JSON.stringify(['Work']) });

    const answers = await run(phone, {});
    const result = shown(answers);

    expect(result).toEqual([]);
  });

  /** A feed the wearer turned on is its own choice, so a phone calendar switched off must not take its copy of an event too. */
  test('still serves a feed that holds the same event', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true, HIDDEN_CALENDARS: JSON.stringify(['Work']), FEED1_ON: true, FEED1_NAME: 'Team' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, DENTIST);
    const result = shown(answers);

    expect(result).toEqual(['Dentist (Team)']);
  });

  /** A wearer updating with nothing saved must keep every phone calendar. */
  test('serves every phone calendar from settings saved without the list', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true });

    const answers = await run(phone, {});
    const result = shown(answers);

    expect(result).toEqual(['Dentist (Work)']);
  });
});

describe('Public Holidays', () => {
  // a holiday all day on Monday 9 November 2026, inside the week
  const HOLIDAYS = feedOf({ title: 'Civic Holiday', start: '20261109', end: '20261110', allDay: true });

  /** A holiday feed has to fetch its country's link, never the iCal link saved beside it, which may be private. */
  test("fetches the country's public holidays and names the feed after them", async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_SOURCE: 'holidays', FEED1_COUNTRY: 'ca' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, HOLIDAYS);
    const result = [shown(answers), phone.fetched.map((url) => url.split('?')[0])];

    expect(result).toEqual([['Civic Holiday (Canada Holidays)'], ['https://calendar.google.com/calendar/ical/en.canadian.official%23holiday%40group.v.calendar.google.com/public/basic.ics']]);
  });

  /** A name the wearer typed is theirs, and must not be swapped for the country's. */
  test('keeps a name the wearer gave the feed', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_SOURCE: 'holidays', FEED1_COUNTRY: 'ca', FEED1_NAME: 'Days Off' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, HOLIDAYS);
    const result = shown(answers);

    expect(result).toEqual(['Civic Holiday (Days Off)']);
  });

  /** Include Observances has to reach the fetch, or the switch changes nothing. */
  test('fetches the calendar with the observances when they are included', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_SOURCE: 'holidays', FEED1_COUNTRY: 'ca', FEED1_OBSERVANCES: true });

    await run(phone, TEAM_LINK, NOW_MS, HOLIDAYS);

    const result = phone.fetched.map((url) => url.split('?')[0]);

    expect(result).toEqual(['https://calendar.google.com/calendar/ical/en.canadian%23holiday%40group.v.calendar.google.com/public/basic.ics']);
  });

  /** A holiday link is not secret, so a locked keystore must not stop it being fetched. */
  test('fetches a holiday feed while the encrypted storage cannot be read', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_SOURCE: 'holidays', FEED1_COUNTRY: 'ca' });

    const answers = await run(phone, 'locked', NOW_MS, HOLIDAYS);
    const result = shown(answers);

    expect(result).toEqual(['Civic Holiday (Canada Holidays)']);
  });

  /** A wearer updating has no Source saved, and their feed must keep fetching its iCal link. */
  test('fetches the iCal link from settings saved without a Source', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team' });

    await run(phone, TEAM_LINK, NOW_MS, HOLIDAYS);

    const result = phone.fetched.map((url) => url.split('?')[0]);

    expect(result).toEqual(['https://example.com/team.ics']);
  });
});

describe('Public Holidays naming and the calendar switches', () => {
  // a holiday all day on Monday 9 November 2026, inside the week
  const HOLIDAYS = feedOf({ title: 'Civic Holiday', start: '20261109', end: '20261110', allDay: true });

  /** A name filled in for one country left saved after the country changed would put Canada's holidays under US Holidays. */
  test('serves a filled in name as the country now picked', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_SOURCE: 'holidays', FEED1_COUNTRY: 'ca', FEED1_NAME: 'US Holidays' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, HOLIDAYS);
    const result = shown(answers);

    expect(result).toEqual(['Civic Holiday (Canada Holidays)']);
  });

  /** The second feed has its own keys, and a holiday feed there must be named and fetched the same way, with observances off by default. */
  test("names and fetches feed 2's holidays, without observances by default", async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED2_ON: true, FEED2_SOURCE: 'holidays', FEED2_COUNTRY: 'jp' });

    const answers = await run(phone, {}, NOW_MS, HOLIDAYS);
    const result = [shown(answers), phone.fetched.map((url) => url.split('?')[0])];

    expect(result).toEqual([['Civic Holiday (Japan Holidays)'], ['https://calendar.google.com/calendar/ical/en.japanese.official%23holiday%40group.v.calendar.google.com/public/basic.ics']]);
  });

  /** The switches list the phone's calendars, so a feed the wearer named the same must not go with them. */
  test('leaves a feed alone that has the same name as a phone calendar switched off', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true, HIDDEN_CALENDARS: JSON.stringify(['Team']), FEED1_ON: true, FEED1_NAME: 'Team' });

    const answers = await run(phone, TEAM_LINK);
    const result = shown(answers);

    expect(result).toEqual(['Dentist (Work)', 'Standup (Team)']);
  });
});

describe('the timeline pins', () => {
  /** The switch has to reach the pins from the saved settings, with the reminder picked, and only for the feed's own events. */
  test("pins the feed's events and not the phone's with the switch on", async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true, FEED1_ON: true, FEED1_NAME: 'Team', TIMELINE_PINS: true, PIN_REMINDER: '30' });

    await run(phone, TEAM_LINK);

    const result = [...phone.pins.values()].map((pin) => [pin.layout.title, pin.reminders?.[0]?.time]);

    expect(result).toEqual([['Standup', '2026-11-05T14:30:00.000Z']]);
  });

  /** A wearer updating has no switch saved, and must get no pins they never asked for. */
  test('pins nothing from settings saved without the switch', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team' });

    await run(phone, TEAM_LINK);

    const result = phone.pins.size;

    expect(result).toBe(0);
  });

  /** What is pinned must not hang on how many events a reader asked for, or two faces would fight over the pins. */
  test('pins past what a reader asked for', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true, FEED1_ON: true, FEED1_NAME: 'Team', TIMELINE_PINS: true });

    await run(phone, TEAM_LINK, NOW_MS, FEED, { category: 'calendar', item: 'event', limit: 1 });

    const result = [...phone.pins.values()].map((pin) => pin.layout.title);

    expect(result).toEqual(['Standup']);
  });
});

describe('the timeline pins and the agenda', () => {
  /** The Pebble app ends the plugin's session once it has the answer, so a pin sent after it may never go. */
  test('pins before it answers', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', TIMELINE_PINS: true });

    await run(phone, TEAM_LINK);

    const result = phone.pinsAtAnswer;

    expect(result).toBe(1);
  });

  /** The Pebble app pins a hidden phone calendar's events itself, so a feed copy pinned here would show twice. */
  test('pins no feed event the phone also holds, even from a calendar switched off', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: true, HIDDEN_CALENDARS: JSON.stringify(['Work']), FEED1_ON: true, FEED1_NAME: 'Team', TIMELINE_PINS: true });
    const dentist = feedOf({ title: 'Dentist', start: '20261105T140000Z', end: '20261105T150000Z' });

    await run(phone, TEAM_LINK, NOW_MS, dentist);

    const result = phone.pins.size;

    expect(result).toBe(0);
  });

  /** A meeting in progress is still on the wearer's day, and its pin must not vanish when it starts. */
  test('keeps the pin of a meeting in progress under Hide Events in Progress', async () => {
    const phone = phoneWith({ PHONE_CALENDARS: false, FEED1_ON: true, FEED1_NAME: 'Team', TIMELINE_PINS: true, HIDE_STARTED: '0' });
    // 11:30 to 12:30 on Wednesday in Toronto, half an hour in
    const running = feedOf({ title: 'Review', start: '20261104T163000Z', end: '20261104T173000Z' });

    const answers = await run(phone, TEAM_LINK, NOW_MS, running);
    const result = [shown(answers), [...phone.pins.values()].map((pin) => pin.layout.title)];

    expect(result).toEqual([[], ['Review']]);
  });
});
