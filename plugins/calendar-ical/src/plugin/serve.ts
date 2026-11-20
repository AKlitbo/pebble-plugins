/**
 * Calendar Enhanced + iCal's answer to the Pebble app, its agenda as the standard `calendar/event`
 * source.
 *
 * Each run reads the settings, reads the phone and both feeds side by side, merges them, and serves
 * the result in the built-in Calendar plugin's shapes. The phone's read and each fetch can take a few
 * seconds, and a run has 20, so none of them waits on another. It serves as many events as the reader
 * asks for, up to 200, and 20 to a reader that names no number. Under Short Labels it also reads the
 * wearer's clock and locale from the Pebble app's Preferences plugin, beside the rest. Before it
 * answers it brings the timeline pins for the feeds' events in line with the agenda.
 *
 * An answer is good for the gap between the Pebble app's runs, or until the next event in it ends or
 * Hide Events in Progress takes it off, or until the phone's next midnight, whichever comes first. A reader that honours the expiry then
 * never keeps an event that has gone for the rest of the gap.
 */

import { keywordMatcher } from '../../paf/ts/calendar/keywords';
import { readSettings } from '../../paf/ts/plugin-app/settings';
import type { SettingsStorage } from '../../paf/ts/plugin-app/settings';
import { eventInstance } from '../../paf/ts/plugin-app/calendar';
import type { EventLabelOptions } from '../../paf/ts/plugin-app/calendar';
import { readPebbleAppPreferences } from '../../paf/ts/plugin-app/preferences';
import type { PluginPebble } from '../../paf/ts/plugin-app/runtime';
import { SOURCE_LIMIT_MAX } from '../../paf/ts/plugin-app/source-limit';
import { phoneDayNumber, phoneMidnight } from '../../paf/ts/pkjs/phone-clock';
import type { PhoneOffset } from '../../paf/ts/pkjs/phone-clock';
import type { SourceInstance } from '../../paf/ts/plugin-sources/types';
import { holidayCalendar, holidayLink, isAutomaticName } from '../holidays';
import { DEFAULTS, SETTINGS_OPTIONS, emailAddresses, feedSourceOf, hiddenCalendars, hideStartedMinutes, lookAheadDays, pinReminderMinutes, switchOn, timeLabelStyle } from '../settings';
import { MAX_EVENTS, mergeAgenda, nextChange } from './agenda';
import { feedEvents } from './feeds';
import type { Feed, FeedStorage, FetchText } from './feeds';
import { phoneEvents, refusePhoneCopy } from './phone';
import type { PhoneStorage } from './phone';
import { syncPins } from './pins';
import type { PinStorage } from './pins';

/** How long an answer is good for, the gap between the Pebble app's runs. */
export const ANSWER_MS = 300 * 1000;

/**
 * How many events the agenda holds for a reader, from the `limit` it asked for.
 *
 * A reader asks for a number from 1 to `SOURCE_LIMIT_MAX`, and one past either end is held to it. A number
 * with a fraction is taken down to the whole number below. A reader that asks for no number, or for
 * something that is not one, gets `MAX_EVENTS`, the agenda's usual length.
 *
 * @param limit The `limit` on the reader's request.
 * @return The most events to serve.
 */
export function agendaLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return MAX_EVENTS;
  }

  return Math.min(SOURCE_LIMIT_MAX, Math.max(1, Math.floor(limit)));
}

/** The answer a run hands the Pebble app. */
export interface AgendaAnswer {
  validUntilMs: number;
  instances: SourceInstance[];
}

/** What a run reads from, which a spec stands in for. */
export interface ServeContext {
  pebble: PluginPebble;
  storage: SettingsStorage & FeedStorage & PhoneStorage & PinStorage;
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
 *
 * @param pebble The plugin runtime's `Pebble`.
 * @param storage Where the settings that are not secret are kept, normally `localStorage`.
 * @return The settings over their defaults, and whether the links in them were read.
 */
export async function readAll(pebble: PluginPebble, storage: SettingsStorage): Promise<{ settings: Record<string, unknown>; linksRead: boolean }> {
  try {
    return { settings: await readSettings(SETTINGS_OPTIONS, pebble, storage, true), linksRead: true };
  } catch {
    return { settings: await readSettings(SETTINGS_OPTIONS, pebble, storage), linksRead: false };
  }
}

/**
 * One feed's settings, with its name falling back to the page's default when the wearer cleared it. A
 * Public Holidays feed fetches its country's link, and takes the country's holiday name while its Name
 * holds nothing the wearer typed, as `isAutomaticName` reads it.
 * The email addresses go to every feed whether Hide Declined Events is on or not, so turning it on or
 * off filters the kept copy rather than fetching the feed again.
 *
 * @param settings The settings, as `readAll` gives them.
 * @param slot The feed.
 * @param linksRead Whether the links in the settings were read.
 * @return The feed, with a null link when the links were not read.
 */
export function feedOf(settings: Record<string, unknown>, slot: 1 | 2, linksRead: boolean): Feed {
  const name = String(settings[`FEED${slot}_NAME`] ?? '').trim();
  const defaultName = DEFAULTS[`FEED${slot}_NAME` as const];
  const feed: Feed = {
    slot,
    on: switchOn(settings, `FEED${slot}_ON`),
    name: name || defaultName,
    url: linksRead ? String(settings[`FEED${slot}_URL`] ?? '') : null,
    addresses: emailAddresses(settings.EMAIL_ADDRESSES),
  };

  if (feedSourceOf(settings[`FEED${slot}_SOURCE`]) === 'holidays') {
    const holidays = holidayCalendar(settings[`FEED${slot}_COUNTRY`]);

    // a holiday link is never secret, so it is known even while the encrypted storage cannot be read
    feed.url = holidayLink(holidays, switchOn(settings, `FEED${slot}_OBSERVANCES`));
    feed.name = isAutomaticName(name, defaultName) ? holidays.name : name;
  }

  return feed;
}

/**
 * How the agenda's start and end labels read. Match the Pebble App needs nothing more. Short Labels
 * read the wearer's clock and locale, and a read the Pebble app refuses gives the 24-hour clock and
 * English names rather than holding the agenda back.
 */
async function labelsFor(style: 'builtIn' | 'short', pebble: PluginPebble, nowSeconds: number): Promise<EventLabelOptions> {
  if (style !== 'short') {
    return {};
  }

  const { preferences } = await readPebbleAppPreferences(pebble);

  return { style: 'short', nowSeconds, clock: preferences ? preferences.clock : null, locale: preferences ? preferences.locale : null };
}

/**
 * The agenda as `calendar/event` instances, and how long they are good for.
 *
 * @param context Where the run reads from.
 * @param nowMs The time now.
 * @param limit The most events to serve, `MAX_EVENTS` when left out.
 * @return The agenda's instances, soonest first, and none with everything off. They are good for
 *   `ANSWER_MS`, or until the next of them ends or leaves under Hide Events in Progress, or until the
 *   phone's next midnight, when that is sooner.
 */
export async function agendaAnswer(context: ServeContext, nowMs: number, limit = MAX_EVENTS): Promise<AgendaAnswer> {
  const { pebble, storage, fetchLink, offsetAt } = context;
  const { settings, linksRead } = await readAll(pebble, storage);
  const nowSeconds = Math.floor(nowMs / 1000);
  const refreshMinutes = Number(settings.REFRESH) || Number(DEFAULTS.REFRESH);
  // the feeds are walked to the same day the agenda stops on, or the two would end at different seconds
  const days = lookAheadDays(settings.LOOK_AHEAD);
  const hideStartedAfter = hideStartedMinutes(settings.HIDE_STARTED);

  const phoneOn = switchOn(settings, 'PHONE_CALENDARS');

  if (!phoneOn) {
    refusePhoneCopy(storage, nowMs);
  }

  const [phone, feed1, feed2, labels] = await Promise.all([
    phoneOn ? phoneEvents(pebble, nowMs, storage, offsetAt) : Promise.resolve([]),
    feedEvents(feedOf(settings, 1, linksRead), refreshMinutes, nowMs, fetchLink, storage, days),
    feedEvents(feedOf(settings, 2, linksRead), refreshMinutes, nowMs, fetchLink, storage, days),
    labelsFor(timeLabelStyle(settings.TIME_LABELS), pebble, nowSeconds),
  ]);

  const filters = {
    hideStartedAfter,
    allDay: switchOn(settings, 'ALL_DAY_EVENTS'),
    hideDeclined: switchOn(settings, 'HIDE_DECLINED'),
    hideTentative: switchOn(settings, 'HIDE_TENTATIVE'),
    hideFree: switchOn(settings, 'HIDE_FREE'),
    hidesTitle: keywordMatcher(typeof settings.HIDE_TITLED === 'string' ? settings.HIDE_TITLED : ''),
  };
  // a phone calendar switched off goes before the merge, so a feed holding the same event still shows it
  const hidden = new Set(hiddenCalendars(settings.HIDDEN_CALENDARS));
  const shownPhone = phone.filter((event) => !event.calendar || !hidden.has(event.calendar));
  // the ids are given in order, so the reader's share keeps the same ids as the whole
  const whole = mergeAgenda(shownPhone, [{ source: 'feed1', events: feed1 }, { source: 'feed2', events: feed2 }], nowSeconds, { days, offsetAt }, filters, SOURCE_LIMIT_MAX);
  const agenda = whole.slice(0, limit);

  // the pins follow their own agenda. it has every phone event, hidden calendars included, so a feed event
  // the phone also holds is never pinned beside the Pebble app's own pin, and no Hide Events in Progress,
  // so a meeting keeps its pin while it runs
  const pinAgenda = mergeAgenda(phone, [{ source: 'feed1', events: feed1 }, { source: 'feed2', events: feed2 }], nowSeconds, { days, offsetAt }, { ...filters, hideStartedAfter: null }, SOURCE_LIMIT_MAX);

  await syncPins(pebble, storage, pinAgenda, { on: switchOn(settings, 'TIMELINE_PINS'), reminderMinutes: pinReminderMinutes(settings.PIN_REMINDER), nowMs });

  // every event still on the agenda leaves after now, so the earlier time is never in the past
  const change = nextChange(agenda, hideStartedAfter);
  // midnight moves the window on a day and turns tomorrow's labels into today's, so no answer outlasts it
  const midnightMs = phoneMidnight(phoneDayNumber(nowSeconds, offsetAt) + 1, offsetAt) * 1000;
  const validUntilMs = Math.min(nowMs + ANSWER_MS, midnightMs, change === null ? Infinity : change * 1000);

  const instances = agenda.map(({ instanceId, event }) => eventInstance(event, instanceId, offsetAt, labels));

  return { validUntilMs, instances };
}

/**
 * Has the Pebble app ask Calendar Enhanced + iCal for its agenda.
 *
 * @param context Where each run reads from.
 * @param clock Reads the time now, normally `Date.now`.
 */
export function handleSource(context: ServeContext, clock: () => number = Date.now): void {
  context.pebble.registerSourceHandler(async (request, respond) => {
    const nowMs = clock();

    try {
      respond.data(await agendaAnswer(context, nowMs, agendaLimit(request?.limit)));
    } catch (error) {
      console.log(`Calendar Enhanced + iCal: the agenda could not be built, ${error}`);
      respond.error('PLUGIN_UNAVAILABLE', String(error));
    }
  });
}
