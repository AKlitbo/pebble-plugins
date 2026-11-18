/**
 * Calendar + iCal's answer to the Pebble app, its agenda as the standard `calendar/event`
 * source.
 *
 * Each run reads the settings, reads the phone and both feeds side by side, merges them, and serves
 * the result in the built-in Calendar plugin's shapes. The phone's read and each fetch can take a few
 * seconds, and a run has 20, so none of them waits on another.
 *
 * An answer is good for the gap between the Pebble app's runs, or until the next event in it ends or
 * Hide Events in Progress takes it off, whichever comes first. A reader that honours the expiry then
 * never keeps an event that has gone for the rest of the gap.
 */

import { readSettings } from '../../paf/ts/plugin-app/settings';
import type { SettingsStorage } from '../../paf/ts/plugin-app/settings';
import { eventInstance } from '../../paf/ts/plugin-app/calendar';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import type { PhoneOffset } from '../../paf/ts/pkjs/phone-clock';
import type { SourceInstance } from '../../paf/ts/plugin-sources/types';
import { DEFAULTS, SETTINGS_OPTIONS, hideStartedMinutes, lookAheadDays, switchOn } from '../settings';
import { mergeAgenda, nextChange } from './agenda';
import { feedEvents } from './feeds';
import type { Feed, FeedStorage, FetchText } from './feeds';
import { phoneEvents } from './phone';

/** How long an answer is good for, the gap between the Pebble app's runs. */
export const ANSWER_MS = 300 * 1000;

/** The answer a run hands the Pebble app. */
export interface AgendaAnswer {
  validUntilMs: number;
  instances: SourceInstance[];
}

/** What a run reads from, which a spec stands in for. */
export interface ServeContext {
  pebble: PluginPebble;
  storage: SettingsStorage & FeedStorage;
  fetchLink: FetchText;
  /** Reads the phone's offset, passed only by a spec that stands the phone in another zone. */
  offsetAt?: PhoneOffset;
}

/**
 * The settings, and whether the feed links in them could be read.
 *
 * A link the encrypted storage cannot read, such as while the phone's keystore is locked, reads as
 * empty, the same as one the wearer cleared. The strict read tells the two apart. It cannot say which
 * link failed, so both feeds serve their copies for that run.
 */
async function readAll(context: ServeContext): Promise<{ settings: Record<string, unknown>; linksRead: boolean }> {
  try {
    return { settings: await readSettings(SETTINGS_OPTIONS, context.pebble, context.storage, true), linksRead: true };
  } catch {
    return { settings: await readSettings(SETTINGS_OPTIONS, context.pebble, context.storage), linksRead: false };
  }
}

/** One feed's settings, with its name falling back to the page's default when the wearer cleared it. */
function feedOf(settings: Record<string, unknown>, slot: 1 | 2, linksRead: boolean): Feed {
  const name = String(settings[`FEED${slot}_NAME`] ?? '').trim();

  return {
    slot,
    on: switchOn(settings, `FEED${slot}_ON`),
    name: name || DEFAULTS[`FEED${slot}_NAME` as const],
    url: linksRead ? String(settings[`FEED${slot}_URL`] ?? '') : null,
  };
}

/**
 * The agenda as `calendar/event` instances, and how long they are good for.
 *
 * @param context Where the run reads from.
 * @param nowMs The time now.
 * @return The agenda's instances, soonest first, and none with everything off. They are good for
 *   `ANSWER_MS`, or until the next of them ends or leaves under Hide Events in Progress when that is
 *   sooner.
 */
export async function agendaAnswer(context: ServeContext, nowMs: number): Promise<AgendaAnswer> {
  const { pebble, storage, fetchLink, offsetAt } = context;
  const { settings, linksRead } = await readAll(context);
  const nowSeconds = Math.floor(nowMs / 1000);
  const refreshMinutes = Number(settings.REFRESH) || Number(DEFAULTS.REFRESH);
  // the feeds are walked to the same day the agenda stops on, or the two would end at different seconds
  const days = lookAheadDays(settings.LOOK_AHEAD);
  const hideStartedAfter = hideStartedMinutes(settings.HIDE_STARTED);

  const [phone, feed1, feed2] = await Promise.all([
    switchOn(settings, 'PHONE_CALENDARS') ? phoneEvents(pebble, nowSeconds, offsetAt) : Promise.resolve([]),
    feedEvents(feedOf(settings, 1, linksRead), refreshMinutes, nowMs, fetchLink, storage, days),
    feedEvents(feedOf(settings, 2, linksRead), refreshMinutes, nowMs, fetchLink, storage, days),
  ]);

  const filters = { hideStartedAfter, allDay: switchOn(settings, 'ALL_DAY_EVENTS') };
  const agenda = mergeAgenda(phone, [{ source: 'feed1', events: feed1 }, { source: 'feed2', events: feed2 }], nowSeconds, { days, offsetAt }, filters);
  // every event still on the agenda leaves after now, so the earlier time is never in the past
  const change = nextChange(agenda, hideStartedAfter);
  const validUntilMs = change === null ? nowMs + ANSWER_MS : Math.min(nowMs + ANSWER_MS, change * 1000);

  return { validUntilMs, instances: agenda.map(({ instanceId, event }) => eventInstance(event, instanceId, offsetAt)) };
}

/**
 * Has the Pebble app ask Calendar + iCal for its agenda.
 *
 * @param context Where each run reads from.
 * @param clock Reads the time now, normally `Date.now`.
 */
export function handleSource(context: ServeContext, clock: () => number = Date.now): void {
  context.pebble.registerSourceHandler(async (_request, respond) => {
    const nowMs = clock();

    try {
      respond.data(await agendaAnswer(context, nowMs));
    } catch (error) {
      console.log(`Calendar + iCal: the agenda could not be built, ${error}`);
      respond.error('PLUGIN_UNAVAILABLE', String(error));
    }
  });
}
