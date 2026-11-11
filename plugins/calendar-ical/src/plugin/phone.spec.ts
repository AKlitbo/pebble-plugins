/**
 * Specs for reading the phone's calendars through the built-in.
 *
 * The built-in sends an all-day event in a different shape on each phone. Android sends UTC midnight
 * to UTC midnight, and an iPhone sends local midnight to 23:59:59 UTC on the last day. Calendar + iCal
 * serves one shape whichever phone it is on, so both have to come out on the same days. A refused read
 * must leave the feeds serving rather than fail the run.
 *
 * The usual now is Wednesday 4 November 2026 at 12:00 in Toronto, which is UTC-5 then.
 */

import { describe, test, expect } from 'vitest';
import { eventInstance } from '../../paf/ts/plugin-app/calendar';
import type { PluginPebble, SourceRequest } from '../../paf/ts/plugin-app/runtime';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';
import { BUILT_IN_CALENDAR, phoneEvents } from './phone';

// Wednesday 4 November 2026, 12:00 in Toronto
const NOW = Date.UTC(2026, 10, 4, 17) / 1000;

/** A runtime whose built-in answers with one update, or refuses, and which records what was asked. */
function fakePebble(answer: SourceEnvelope | Error) {
  const subscribed: SourceRequest[] = [];
  const pebble = {
    subscribeSource: (request: SourceRequest) => void subscribed.push(request),
    readSource: async () => {
      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    },
  } as unknown as PluginPebble;

  return { pebble, subscribed };
}

/** The built-in's update holding one all-day event, starting and ending where the phone puts them. */
function allDayUpdate(startSeconds: number, endSeconds: number): SourceEnvelope {
  return {
    instances: [
      {
        instanceId: '0',
        properties: {
          name: { shortText: { text: 'Holiday' }, longText: { text: 'Holiday' } },
          starts_at: { shortText: { text: 'All day' }, timestamp: { value: startSeconds } },
          ends_at: { shortText: { text: 'All day' }, timestamp: { value: endSeconds } },
          all_day: { boolean: { value: true } },
        },
      },
    ],
  };
}

/** Where an update's all-day event lands once served again. */
async function servedDays(update: SourceEnvelope): Promise<Array<number | undefined>> {
  const events = await phoneEvents(fakePebble(update).pebble, NOW);
  const served = eventInstance(events[0], 'holiday').properties;

  return [served?.starts_at?.timestamp?.value, served?.ends_at?.timestamp?.value];
}

describe('phoneEvents', () => {
  /** A face reading Calendar + iCal must see Friday's holiday on Friday, from either phone. */
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

    await phoneEvents(pebble, NOW);

    expect(subscribed.map((request) => request.plugin)).toEqual([BUILT_IN_CALENDAR]);
  });

  /** A wearer who has not allowed the read, or a built-in that times out, must still get the feeds. */
  test.each(['PERMISSION_DENIED', 'PLUGIN_UNAVAILABLE', 'TIMEOUT'])('serves nothing from the phone on %s', async (code) => {
    const refused = Object.assign(new Error(code), { code });

    const result = await phoneEvents(fakePebble(refused).pebble, NOW);

    expect(result).toEqual([]);
  });
});
