/**
 * Calendar Enhanced + iCal's two iCal feeds, each fetched again once its copy is older than the
 * iCal Refresh Interval.
 *
 * The plugin has no timers. It runs cold whenever the Pebble app asks, about every five minutes, so
 * each run decides for itself whether a feed's copy is still fresh, and the iCal Refresh Interval only
 * spaces the fetches out across those runs. A fetch that fails, or brings back something that is not iCal,
 * keeps the last good copy and is tried again on the next run. Each event keeps its notes, and its
 * free, tentative, and declined marks, so the agenda can serve the notes and filter on the marks. A
 * copy kept with none serves without them until its next fetch. Which events read as declined hangs
 * on the wearer's email addresses, so a copy read for other addresses is fetched again.
 *
 * The copies sit in `localStorage` with a fingerprint of the link they came from rather than the link
 * itself, since a private link works like a password and only the encrypted storage holds it.
 *
 * Each feed keeps a status beside its copy, for the settings page: when the last good fetch was, how
 * many events it gave, and the kind of the last failure since then. The kind is a short code such as
 * `HTTP 404`, `TIMEOUT`, or `NOT_ICAL`, never the runtime's own error text, which can carry the link.
 *
 * A feed is read for up to 200 events whatever a reader asked for, since one copy serves every reader.
 */

import type { CalendarEvent } from '../../paf/ts/calendar/ical';
import ical from '../../paf/ts/calendar/ical';
import { fingerprint } from '../../paf/ts/pkjs/fingerprint';
import { phoneDayNumber } from '../../paf/ts/pkjs/phone-clock';
import { cacheBust } from '../../paf/ts/pkjs/request';
import { fetchFailure } from '../../paf/ts/plugin-app/request';
import { SOURCE_LIMIT_MAX } from '../../paf/ts/plugin-app/source-limit';

/** One feed as the settings give it. */
export interface Feed {
  slot: 1 | 2;
  on: boolean;
  /** The wearer's name for it, which its events carry as their calendar. */
  name: string;
  /** Its iCal link, empty when the wearer has given none, and null when the encrypted storage could not be read. */
  url: string | null;
  /** The wearer's own email addresses, which pick out an event they declined. None when left out. */
  addresses?: readonly string[];
}

/** Fetches a link's text, rejecting on anything but a good answer. */
export type FetchText = (url: string) => Promise<string>;

/** The part of `localStorage` the feeds use, which a spec stands in for. */
export type FeedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * A feed's status as the settings page shows it. Each part is left out until there is one to give,
 * and a failure is only kept until the next good fetch.
 */
export interface FeedStatus {
  /** When the last good fetch was. */
  fetchedMs?: number;
  /** How many events it gave. */
  events?: number;
  /**
   * The kind of the last failure: one of `fetchFailure`'s kinds, with an `HTTP` one carrying its status
   * as `HTTP 404`, or `NOT_ICAL` for an answer that is not iCal.
   */
  error?: string;
  /** When the last failure was. */
  errorMs?: number;
}

/** A feed's status as kept between runs, with the fingerprint of the link it is for. */
interface KeptStatus extends FeedStatus {
  link: string;
}

/** A feed's last good copy, as kept between runs. */
interface FeedCopy {
  link: string;
  fetchedMs: number;
  /** The Look Ahead it was read for. */
  days?: number;
  /** A fingerprint of the email addresses it was read for, left out for none. */
  addresses?: string;
  events: CalendarEvent[];
}

// the Pebble app's runs come about five minutes apart and can land a little early
// a copy this close to the iCal Refresh Interval counts as due, or a 5 minute interval would fetch every other run
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
 * Where a feed's status is kept in `localStorage`.
 *
 * @param slot The feed.
 * @return Its storage key.
 */
export function statusKey(slot: 1 | 2): string {
  return `calendar-ical-feed-${slot}-status`;
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

/** The kind of a failed fetch, as the status keeps it and the log names it, such as `HTTP 404` or `TIMEOUT`. */
function failureText(error: unknown): string {
  const failure = fetchFailure(error);

  return failure.kind === 'HTTP' ? `HTTP ${failure.status}` : failure.kind;
}

/**
 * A stamp kept before the framework's fingerprint was used, the FNV-1a hash in hex.
 *
 * Copies and statuses kept by 1.2.0 carry their link's stamp in this form. Matching it as well as the
 * current one costs a second hash on each check, and saves refetching every feed the run after the
 * update. The next write stamps the copy the current way, so each copy matches this way once.
 */
function oldStamp(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }

  return hash.toString(16);
}

/** Whether a kept stamp is the stamp of this text, in the current form or the old one. */
function stampMatches(kept: unknown, text: string): boolean {
  return kept === fingerprint(text) || kept === oldStamp(text);
}

/**
 * The wearer's email addresses as one text, the same whatever their case, the spaces at their ends,
 * and their order, and empty for none. Only its stamp is ever kept, never the addresses.
 */
function addressesText(addresses: readonly string[] | undefined): string {
  return (addresses || [])
    .map((address) => address.trim().toLowerCase())
    .filter((address) => address.length > 0)
    .sort()
    .join(',');
}

/** Whether a copy was read for these addresses. A copy kept with no stamp was read for none. */
function sameAddresses(kept: string | undefined, text: string): boolean {
  return text === '' ? !kept : stampMatches(kept, text);
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

/** A feed's kept status, or null for none or one that does not read back as a status. */
function readStatus(storage: FeedStorage, slot: 1 | 2): KeptStatus | null {
  try {
    const status = JSON.parse(storage.getItem(statusKey(slot)) || 'null');

    return status && typeof status.link === 'string' ? status : null;
  } catch {
    return null;
  }
}

/** Keeps a feed's status, logging rather than failing the run when storage refuses it. */
function writeStatus(storage: FeedStorage, slot: 1 | 2, status: KeptStatus): void {
  try {
    storage.setItem(statusKey(slot), JSON.stringify(status));
  } catch (error) {
    console.log(`Calendar Enhanced + iCal: feed ${slot}'s status could not be kept, ${error}`);
  }
}

/**
 * What is kept about a feed's fetches for a link, or for whatever link is kept when it is null: the
 * status, or the copy's own fetch time and count when no status is kept beside it.
 */
function keptStatus(storage: FeedStorage, slot: 1 | 2, link: string | null): FeedStatus | null {
  const status = readStatus(storage, slot);

  if (status && (link === null || stampMatches(status.link, link))) {
    const { fetchedMs, events, error, errorMs } = status;

    return { fetchedMs, events, error, errorMs };
  }

  const copy = readCopy(storage, slot);

  return copy && (link === null || stampMatches(copy.link, link)) ? { fetchedMs: copy.fetchedMs, events: copy.events.length } : null;
}

/** Drops a feed's copy and its status, so neither outlives the link they were for. */
function dropFeed(storage: FeedStorage, slot: 1 | 2): void {
  storage.removeItem(copyKey(slot));
  storage.removeItem(statusKey(slot));
}

/**
 * Whether a copy can still be served without a fetch.
 *
 * The reader only walks a feed up to the end of the Look Ahead, so a copy from before midnight has
 * nothing for the day the window gained at midnight, and a copy read for another Look Ahead stops
 * on another day. A copy read for other email addresses can have other events marked declined. A
 * clock set back makes the copy look younger than nothing, which is no reason to keep it either.
 */
function isFresh(copy: FeedCopy, refreshMinutes: number, nowMs: number, days: number | undefined, addresses: string): boolean {
  const age = nowMs - copy.fetchedMs;
  const sameDay = phoneDayNumber(copy.fetchedMs / 1000) === phoneDayNumber(nowMs / 1000);

  // a copy saved before the Look Ahead existed, or a run with none set, was read for the week
  return sameDay && (copy.days ?? 7) === (days ?? 7) && sameAddresses(copy.addresses, addresses) && age >= 0 && age < refreshMinutes * 60 * 1000 - EARLY_RUN_MS;
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
 * @param days How many days the agenda holds, today counted, as `parseIcal` takes them. Left out,
 *   the week.
 * @return The feed's events, its last good copy when a fetch fails, and none for a feed that is off.
 */
export async function feedEvents(feed: Feed, refreshMinutes: number, nowMs: number, fetchLink: FetchText, storage: FeedStorage, days?: number): Promise<CalendarEvent[]> {
  const key = copyKey(feed.slot);

  if (!feed.on) {
    dropFeed(storage, feed.slot);
    return [];
  }

  const kept = readCopy(storage, feed.slot);

  // a feed switched from Public Holidays to a link while the keystore is locked serves the kept holiday
  // copy under the link feed's name until the link can be read. the copy is public data, and the gap
  // ends at the link's first fetch, which costs less than emptying the feed on every locked run
  if (feed.url === null) {
    return kept ? named(kept.events, feed.name) : [];
  }

  const link = feedLink(feed.url);

  if (!link) {
    dropFeed(storage, feed.slot);
    return [];
  }

  const copy = kept && stampMatches(kept.link, link) ? kept : null;

  if (kept && !copy) {
    storage.removeItem(key);
  }

  const addresses = addressesText(feed.addresses);

  if (copy && isFresh(copy, refreshMinutes, nowMs, days, addresses)) {
    return named(copy.events, feed.name);
  }

  let events: CalendarEvent[] | null = null;
  let failure = 'NOT_ICAL';

  try {
    events = ical.parseIcal(await fetchLink(cacheBust(link, nowMs)), Math.floor(nowMs / 1000), days, { descriptions: true, marks: true, wearerAddresses: feed.addresses || [], maxEvents: SOURCE_LIMIT_MAX });
  } catch (error) {
    failure = failureText(error);
    console.log(`Calendar Enhanced + iCal: feed ${feed.slot} could not be fetched, ${failure}`);
  }

  const stamp = fingerprint(link);

  if (!events) {
    // read again now the fetch is over, since a run that overlapped this one may have kept a newer fetch
    const before = keptStatus(storage, feed.slot, link);

    if (!before || before.fetchedMs === undefined || before.fetchedMs <= nowMs) {
      writeStatus(storage, feed.slot, { link: stamp, fetchedMs: before?.fetchedMs, events: before?.events, error: failure, errorMs: nowMs });
    }

    // an error page or a cut off body says nothing about the calendar, so the last good copy stands
    return copy ? named(copy.events, feed.name) : [];
  }

  try {
    storage.setItem(key, JSON.stringify({ link: stamp, fetchedMs: nowMs, days, addresses: addresses ? fingerprint(addresses) : undefined, events }));
    // the status follows the copy, so a copy that could not be kept never reads as fetched
    writeStatus(storage, feed.slot, { link: stamp, fetchedMs: nowMs, events: events.length });
  } catch (error) {
    console.log(`Calendar Enhanced + iCal: feed ${feed.slot} could not be kept, ${error}`);
  }

  return named(events, feed.name);
}

/**
 * A feed's status for the settings page, for the link the feed has now.
 *
 * A status kept for another link, from before the wearer changed it, is no status at all. A copy kept
 * with no status beside it gives its own fetch time and count. A link the encrypted storage could not
 * read shows whatever is kept, since the run serves the copy then too.
 *
 * @param feed The feed.
 * @param storage Where the copies and statuses are kept, normally `localStorage`.
 * @return The feed's status, or null for a feed that is off, has no link, or has nothing kept.
 */
export function feedStatus(feed: Feed, storage: FeedStorage): FeedStatus | null {
  const link = feed.url === null ? null : feedLink(feed.url);

  if (!feed.on || link === '') {
    return null;
  }

  return keptStatus(storage, feed.slot, link);
}
