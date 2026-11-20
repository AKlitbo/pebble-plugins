/**
 * Specs for reading the phone's calendars through the built-in.
 *
 * The built-in sends an all-day event in a different shape on each phone. Android sends UTC midnight
 * to UTC midnight, and an iPhone sends local midnight to 23:59:59 UTC on the last day. Calendar
 * Enhanced + iCal serves one shape whichever phone it is on, so both have to come out on the same
 * days. A refused read must leave the feeds serving rather than fail the run.
 *
 * The kept read is the other thing worth pinning. A read that fails without the wearer refusing it,
 * such as one that times out, has to serve the last good read, or one slow read empties the phone's
 * part of the agenda, but only for three hours, and never when the clock has gone back past it. A
 * refusal has to drop it, or turning Calendar off leaves the events on the watch. Runs overlap, so a
 * slow run finishing last must neither replace a newer run's read nor bring back a refused one.
 *
 * The settings page's list of calendars reads the phone too, and must never change what a run serves.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in Toronto, which is UTC-5 then.
 */

import { describe, test, expect } from 'vitest';
import { eventInstance } from '../../paf/ts/plugin-app/calendar';
import type { PluginPebble, SourceRequest } from '../../paf/ts/plugin-app/runtime';
import type { SourceEnvelope, SourceProperty } from '../../paf/ts/plugin-sources/types';
import { BUILT_IN_CALENDAR, PHONE_COPY_MS, phoneCalendarNames, phoneEvents, refusePhoneCopy } from './phone';
import type { PhoneStorage } from './phone';

// Wednesday 4 November 2026, 12:00 in Toronto
const NOW_MS = Date.UTC(2026, 10, 4, 17);

const MINUTE_MS = 60 * 1000;

/**
 * A runtime whose built-in answers each read with the next of these, an update or a refusal, the last
 * one again once they run out, and which records what was asked.
 */
function fakePebble(...answers: Array<SourceEnvelope | Error>) {
  const subscribed: SourceRequest[] = [];
  const read: SourceRequest[] = [];
  const pebble = {
    subscribeSource: (request: SourceRequest) => void subscribed.push(request),
    readSource: async (request: SourceRequest) => {
      const answer = answers.length > 1 ? answers.shift() : answers[0];

      read.push(request);

      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    },
  } as unknown as PluginPebble;

  return { pebble, subscribed, read };
}

/** A refusal from the Pebble app, carrying its code as the runtime's do. */
function refusal(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** A plain storage that starts empty. */
function fakeStorage(): PhoneStorage {
  const items = new Map<string, string>();

  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value), removeItem: (key) => void items.delete(key) };
}

/** The built-in's update holding one all-day event, starting and ending where the phone puts them, with any more properties given. */
function allDayUpdate(startSeconds: number, endSeconds: number, more: Record<string, SourceProperty> = {}): SourceEnvelope {
  return {
    instances: [
      {
        instanceId: '0',
        properties: {
          name: { shortText: { text: 'Holiday' }, longText: { text: 'Holiday' } },
          starts_at: { shortText: { text: 'All day' }, timestamp: { value: startSeconds } },
          ends_at: { shortText: { text: 'All day' }, timestamp: { value: endSeconds } },
          all_day: { boolean: { value: true } },
          ...more,
        },
      },
    ],
  };
}

/** Where an update's all-day event lands once served again. */
async function servedDays(update: SourceEnvelope): Promise<Array<number | undefined>> {
  const events = await phoneEvents(fakePebble(update).pebble, NOW_MS, fakeStorage());
  const served = eventInstance(events[0], 'holiday').properties;

  return [served?.starts_at?.timestamp?.value, served?.ends_at?.timestamp?.value];
}

describe('phoneEvents', () => {
  /** A face reading Calendar Enhanced + iCal must see Friday's holiday on Friday, from either phone. */
  test.each([
    ['an Android', Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000],
    ['an iPhone', Date.UTC(2026, 10, 6, 5) / 1000, Date.UTC(2026, 10, 6, 23, 59, 59) / 1000],
  ])("serves %s phone's all-day event on the UTC midnights of its day", async (label, start, end) => {
    const result = await servedDays(allDayUpdate(start, end));

    expect(result).toEqual([Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000]);
  });

  /** The subscription is what brings a run when the phone's calendars change, and it has to name the built-in. */
  test('subscribes to the built-in by its uuid', async () => {
    const { pebble, subscribed } = fakePebble(allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000));

    await phoneEvents(pebble, NOW_MS, fakeStorage());

    expect(subscribed.map((request) => request.plugin)).toEqual([BUILT_IN_CALENDAR]);
  });

  /**
   * The built-in stops at 10 events unless asked for more, and sends no notes unless asked for them, so
   * a busy week would lose meetings and every phone event its notes.
   */
  test('asks the built-in for 200 events with their notes', async () => {
    const { pebble, read } = fakePebble(allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000));

    await phoneEvents(pebble, NOW_MS, fakeStorage());

    expect(read.map((request) => [request.limit, request.properties?.includes('description')])).toEqual([[200, true]]);
  });

  /** A phone event's notes have to reach a face the way the built-in sends them, or switching plugins loses them. */
  test("serves a phone event's notes", async () => {
    const update = allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000, { description: { longText: { text: 'Bring the passports' } } });
    const events = await phoneEvents(fakePebble(update).pebble, NOW_MS, fakeStorage());

    const result = eventInstance(events[0], 'holiday').properties?.description;

    expect(result).toEqual({ longText: { text: 'Bring the passports' } });
  });

  /** A wearer who has not allowed the read, or a built-in that times out with nothing kept, must still get the feeds. */
  test.each(['PERMISSION_DENIED', 'PLUGIN_UNAVAILABLE', 'TIMEOUT'])('serves nothing from the phone on %s with nothing kept', async (code) => {
    const result = await phoneEvents(fakePebble(refusal(code)).pebble, NOW_MS, fakeStorage());

    expect(result).toEqual([]);
  });

  /** One slow read of the phone would otherwise empty the phone's part of the agenda until the next run. */
  test.each(['TIMEOUT', 'PLUGIN_UNAVAILABLE'])('serves the last good read on %s', async (code) => {
    const storage = fakeStorage();
    const { pebble } = fakePebble(allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000), refusal(code));

    await phoneEvents(pebble, NOW_MS, storage);

    const result = await phoneEvents(pebble, NOW_MS + 5 * MINUTE_MS, storage);

    expect(result.map((event) => event.title)).toEqual(['Holiday']);
  });

  /** Turning Calendar off has to take the phone's events off the watch, not leave the last read serving. */
  test('drops the last good read when the wearer refuses the read', async () => {
    const storage = fakeStorage();
    const { pebble } = fakePebble(allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000), refusal('PERMISSION_DENIED'), refusal('TIMEOUT'));

    await phoneEvents(pebble, NOW_MS, storage);
    await phoneEvents(pebble, NOW_MS + 5 * MINUTE_MS, storage);

    const result = await phoneEvents(pebble, NOW_MS + 10 * MINUTE_MS, storage);

    expect(result).toEqual([]);
  });

  /** A good read that comes back empty is the phone's real answer, so a later slow read must not bring the old events back. */
  test('keeps an empty read as the last good one', async () => {
    const storage = fakeStorage();
    const { pebble } = fakePebble(allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000), { instances: [] }, refusal('TIMEOUT'));

    await phoneEvents(pebble, NOW_MS, storage);
    await phoneEvents(pebble, NOW_MS + 5 * MINUTE_MS, storage);

    const result = await phoneEvents(pebble, NOW_MS + 10 * MINUTE_MS, storage);

    expect(result).toEqual([]);
  });

  /** A read kept for days would show an event long since moved or cancelled on the phone as it was. */
  test('serves the last good read for three hours and no longer', async () => {
    const storage = fakeStorage();
    const { pebble } = fakePebble(allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000), refusal('TIMEOUT'));

    await phoneEvents(pebble, NOW_MS, storage);

    const result = [(await phoneEvents(pebble, NOW_MS + PHONE_COPY_MS, storage)).length, (await phoneEvents(pebble, NOW_MS + PHONE_COPY_MS + 1, storage)).length];

    expect(result).toEqual([1, 0]);
  });

  /** A clock set back makes the kept read look like it comes from the future, which says nothing about how old it is. */
  test('serves no kept read that looks younger than nothing', async () => {
    const storage = fakeStorage();
    const { pebble } = fakePebble(allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000), refusal('TIMEOUT'));

    await phoneEvents(pebble, NOW_MS, storage);

    const result = await phoneEvents(pebble, NOW_MS - MINUTE_MS, storage);

    expect(result).toEqual([]);
  });

  /** A slow run that started first and finished last would put its older read over the newer one. */
  test("keeps a later run's read over an earlier run's that finishes after it", async () => {
    const storage = fakeStorage();
    const later = fakePebble({ instances: [] }, refusal('TIMEOUT'));
    const earlier = fakePebble(allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000));

    await phoneEvents(later.pebble, NOW_MS + MINUTE_MS, storage);
    await phoneEvents(earlier.pebble, NOW_MS, storage);

    const result = await phoneEvents(later.pebble, NOW_MS + 2 * MINUTE_MS, storage);

    expect(result).toEqual([]);
  });

  /** A slow run finishing after the wearer turned the phone's calendars off would bring the events straight back. */
  test('never brings back a read refused by a later run', async () => {
    const storage = fakeStorage();
    const { pebble } = fakePebble(allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000), refusal('TIMEOUT'));

    refusePhoneCopy(storage, NOW_MS + MINUTE_MS);
    await phoneEvents(pebble, NOW_MS, storage);

    const result = await phoneEvents(pebble, NOW_MS + 2 * MINUTE_MS, storage);

    expect(result).toEqual([]);
  });
});

describe('phoneCalendarNames', () => {
  /** The settings page lists these, and a repeat or an unsorted list reads as a different calendar each time. */
  test('gives each calendar once, sorted', async () => {
    const { pebble } = fakePebble({ instances: ['Work', 'Family', 'Work'].map((calendar, index) => ({ instanceId: String(index), properties: { name: { longText: { text: 'Meeting' } }, starts_at: { timestamp: { value: NOW_MS / 1000 + 3600 * (index + 1) } }, calendar: { longText: { text: calendar } } } })) });

    const result = await phoneCalendarNames(pebble, NOW_MS, fakeStorage());

    expect(result).toEqual({ calendars: ['Family', 'Work'] });
  });

  /** A slow phone read while the page is open would leave the wearer with no list to switch. */
  test('takes the names from the kept read when the read fails', async () => {
    const storage = fakeStorage();
    const holiday = allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000, { calendar: { longText: { text: 'Family' } } });

    await phoneEvents(fakePebble(holiday).pebble, NOW_MS, storage);

    const result = await phoneCalendarNames(fakePebble(refusal('TIMEOUT')).pebble, NOW_MS + PHONE_COPY_MS * 2, storage);

    expect(result).toEqual({ calendars: ['Family'] });
  });

  /** A refusal listed as an empty week would tell the wearer they have no events rather than that Calendar is not allowed. */
  test('answers a refusal apart from an empty list, kept read or not', async () => {
    const storage = fakeStorage();
    const holiday = allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000, { calendar: { longText: { text: 'Family' } } });

    await phoneEvents(fakePebble(holiday).pebble, NOW_MS, storage);

    const result = await phoneCalendarNames(fakePebble(refusal('PERMISSION_DENIED')).pebble, NOW_MS, storage);

    expect(result).toEqual({ calendars: [], error: 'PERMISSION_DENIED' });
  });

  /** The page only needs the calendars, so titles, places, and notes would cross the phone for nothing, and a smaller limit could miss a calendar. */
  test('asks for the calendars with no titles, places, or notes, and as many events as a read gives', async () => {
    const { pebble, read } = fakePebble({ instances: [] });

    await phoneCalendarNames(pebble, NOW_MS, fakeStorage());

    expect(read.map((request) => [request.limit, request.properties])).toEqual([[200, ['starts_at', 'ends_at', 'all_day', 'calendar']]]);
  });

  /** The page asking must never change what a run serves, so it neither subscribes nor keeps a read. */
  test('neither subscribes nor keeps the read', async () => {
    const storage = fakeStorage();
    const { pebble, subscribed } = fakePebble(allDayUpdate(Date.UTC(2026, 10, 6) / 1000, Date.UTC(2026, 10, 7) / 1000));

    await phoneCalendarNames(pebble, NOW_MS, storage);

    expect([subscribed.length, storage.getItem('calendar-ical-phone')]).toEqual([0, null]);
  });
});
