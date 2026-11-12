/**
 * Calendar + iCal's two iCal feeds, each fetched again once its copy is older than the Refresh Interval.
 *
 * The plugin has no timers. It runs cold whenever the Pebble app asks, about every five minutes, so
 * each run decides for itself whether a feed's copy is still fresh, and the Refresh Interval only spaces
 * the fetches out across those runs. A fetch that fails, or brings back something that is not iCal,
 * keeps the last good copy and is tried again on the next run.
 *
 * The copies sit in `localStorage` with a fingerprint of the link they came from rather than the link
 * itself, since a private link works like a password and only the encrypted storage holds it.
 */

import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import ical from '../../paf/ts/calendar/ical';
import { phoneDayNumber } from '../../paf/ts/pkjs/phone-clock';
import { cacheBust } from '../../paf/ts/pkjs/request';

/** One feed as the settings give it. */
export interface Feed {
  slot: 1 | 2;
  on: boolean;
  /** The wearer's name for it, which its events carry as their calendar. */
  name: string;
  /** Its iCal link, empty when the wearer has given none, and null when the encrypted storage could not be read. */
  url: string | null;
}

/** Fetches a link's text, rejecting on anything but a good answer. */
export type FetchText = (url: string) => Promise<string>;

/** The part of `localStorage` the feeds use, which a spec stands in for. */
export type FeedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A feed's last good copy, as kept between runs. */
interface FeedCopy {
  link: string;
  fetchedMs: number;
  events: CalendarEvent[];
}

// the Pebble app's runs come about five minutes apart and can land a little early
// a copy this close to the Refresh Interval counts as due, or a 5 minute interval would fetch every other run
const EARLY_RUN_MS = 60 * 1000;

/**
 * Where a feed's copy is kept in `localStorage`.
 *
 * @param slot The feed.
 * @return Its storage key.
 */
export function copyKey(slot: 1 | 2): string {
  return `calendar-ical-feed-${slot}`;
}

/**
 * A feed's link as it is fetched. A Subscribe link, such as an iCloud public calendar, starts webcal://
 * or webcals://, which is https underneath. A link pasted without its scheme gets https://, since
 * fetch refuses one with none.
 */
function feedLink(url: string): string {
  const link = url.trim().replace(/^webcals?:\/\//i, 'https://');

  return !link || /^[a-z][a-z0-9+.-]*:\/\//i.test(link) ? link : `https://${link}`;
}

/**
 * Why a fetch failed, safe to log. A runtime's own fetch error can carry the link, which is the
 * secret, so only an HTTP status from fetchText or the error's name goes out.
 */
function failureOf(error: unknown): string {
  if (error instanceof Error && /^HTTP \d+$/.test(error.message)) {
    return error.message;
  }

  return (error instanceof Error && error.name) || 'an unknown failure';
}

/** A short fingerprint of a link, enough to tell a changed link from the same one without keeping the link. */
function fingerprint(link: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < link.length; index++) {
    hash = Math.imul(hash ^ link.charCodeAt(index), 0x01000193) >>> 0;
  }

  return hash.toString(16);
}

/** A feed's kept copy, or null for none or one that does not read back as a copy. */
function readCopy(storage: FeedStorage, slot: 1 | 2): FeedCopy | null {
  try {
    const copy = JSON.parse(storage.getItem(copyKey(slot)) || 'null');

    return copy && typeof copy.link === 'string' && typeof copy.fetchedMs === 'number' && Array.isArray(copy.events) ? copy : null;
  } catch {
    return null;
  }
}

/**
 * Whether a copy can still be served without a fetch.
 *
 * The reader only walks a feed up to the end of the agenda's week, so a copy from before midnight has
 * nothing for the day the week gained at midnight. A clock set back makes the copy look younger than
 * nothing, which is no reason to keep it either.
 */
function isFresh(copy: FeedCopy, refreshMinutes: number, nowMs: number): boolean {
  const age = nowMs - copy.fetchedMs;
  const sameDay = phoneDayNumber(copy.fetchedMs / 1000) === phoneDayNumber(nowMs / 1000);

  return sameDay && age >= 0 && age < refreshMinutes * 60 * 1000 - EARLY_RUN_MS;
}

/** A feed's events, each carrying the feed's name as its calendar. */
function named(events: CalendarEvent[], name: string): CalendarEvent[] {
  return events.map((event) => ({ ...event, calendar: name }));
}

/**
 * A feed's events, from its copy while that is fresh and from a fetch once it is not.
 *
 * Turning the feed off drops its copy, and so do a changed link and a cleared one, so a feed never
 * serves another link's events. A link the encrypted storage could not read serves the copy as it is,
 * since the phone's keystore can be locked for a while.
 *
 * @param feed The feed.
 * @param refreshMinutes How old a copy can get before it is fetched again.
 * @param nowMs The time now.
 * @param fetchLink Fetches a link's text, normally `fetchText`.
 * @param storage Where the copies are kept, normally `localStorage`.
 * @return The feed's events, its last good copy when a fetch fails, and none for a feed that is off.
 */
export async function feedEvents(feed: Feed, refreshMinutes: number, nowMs: number, fetchLink: FetchText, storage: FeedStorage): Promise<CalendarEvent[]> {
  const key = copyKey(feed.slot);

  if (!feed.on) {
    storage.removeItem(key);
    return [];
  }

  const kept = readCopy(storage, feed.slot);

  if (feed.url === null) {
    return kept ? named(kept.events, feed.name) : [];
  }

  const link = feedLink(feed.url);

  if (!link) {
    storage.removeItem(key);
    return [];
  }

  const stamp = fingerprint(link);
  const copy = kept && kept.link === stamp ? kept : null;

  if (kept && !copy) {
    storage.removeItem(key);
  }

  if (copy && isFresh(copy, refreshMinutes, nowMs)) {
    return named(copy.events, feed.name);
  }

  let events: CalendarEvent[] | null = null;

  try {
    events = ical.parseIcal(await fetchLink(cacheBust(link, nowMs)), Math.floor(nowMs / 1000));
  } catch (error) {
    console.log(`Calendar + iCal: feed ${feed.slot} could not be fetched, ${failureOf(error)}`);
  }

  if (!events) {
    // an error page or a cut off body says nothing about the calendar, so the last good copy stands
    return copy ? named(copy.events, feed.name) : [];
  }

  try {
    storage.setItem(key, JSON.stringify({ link: stamp, fetchedMs: nowMs, events }));
  } catch (error) {
    console.log(`Calendar + iCal: feed ${feed.slot} could not be kept, ${error}`);
  }

  return named(events, feed.name);
}
