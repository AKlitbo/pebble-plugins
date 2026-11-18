/**
 * The copy of each place's last reading, kept between runs.
 *
 * The Pebble app runs the plugin far more often than the weather is worth fetching, so most runs
 * answer from these copies. Each place keeps its own, under the place's key from the Pebble app's
 * weather list, so a place added to the list is fetched without the others. A copy carries the
 * provider and a fingerprint of the API key, never the key itself, since only the encrypted storage
 * holds that. A copy made under another provider or key is not served.
 *
 * Each place also keeps when it was last asked for, so a provider that failed is not asked again on
 * every run. The Pebble app runs each subscriber every 15 minutes whatever the answer says, so without
 * it a provider down for hours would be asked for every place on every run.
 *
 * A place lets go of both only once the wearer switches it off or removes it, so switched back on it is
 * fetched straight away. A place missing from one run for any other reason, such as the current
 * location with no fix or every Pebble app place while the read is refused, keeps both.
 */

import type { WeatherReading } from '../../paf/ts/weather/reading';
import type { ProviderId } from '../settings';

/** Where the copies are kept in `localStorage`. */
export const COPIES_KEY = 'weather-enhanced-copies';

/** Where each place's last ask is kept in `localStorage`. */
export const TRIES_KEY = 'weather-enhanced-tries';

// the Pebble app's runs can land a little early
// a copy this close to the Refresh Interval counts as due, or a 15 minute interval would fetch every other run
export const EARLY_RUN_MS = 60 * 1000;

/** How many Refresh Intervals a copy is served for while the provider cannot answer. */
export const COPY_LASTS_INTERVALS = 3;

/** The part of `localStorage` the copies use, which a spec stands in for. */
export type CopyStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** One place's copy as kept. */
export interface Copy {
  /** The provider picked when it was fetched, which can differ from the reading's own `source` after a failover. */
  provider: ProviderId;
  /** The fingerprint of the API key, empty for Open-Meteo. */
  print: string;
  /** When it was fetched. */
  fetchedMs: number;
  reading: WeatherReading;
}

/** True for a copy that reads back the way it was kept. A reading's own fields are left to `locationInstance`. */
function isCopy(copy: unknown): copy is Copy {
  const kept = copy as Copy | null;
  const reading = kept && kept.reading;

  return Boolean(
    kept && typeof kept.provider === 'string' && typeof kept.print === 'string' && typeof kept.fetchedMs === 'number' && Number.isFinite(kept.fetchedMs) &&
      reading && reading.ok === true && typeof reading.time === 'number' && typeof reading.utcOffset === 'number' &&
      reading.condition && typeof reading.condition.token === 'string' &&
      reading.hourly && Array.isArray(reading.hourly.time) && reading.daily && Array.isArray(reading.daily.time)
  );
}

/**
 * The kept copies, by place key.
 *
 * @param storage Where the copies are kept, normally `localStorage`.
 * @return Each copy that reads back as one, and none for anything else.
 */
export function readCopies(storage: CopyStorage): Record<string, Copy> {
  const copies: Record<string, Copy> = {};

  try {
    const saved = JSON.parse(storage.getItem(COPIES_KEY) || 'null');

    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      Object.keys(saved).forEach((key) => {
        if (isCopy(saved[key])) {
          copies[key] = saved[key];
        }
      });
    }
  } catch {
    // unreadable, so every place is fetched again
  }

  return copies;
}

/**
 * Keeps the copies, in place of every one kept before.
 *
 * @param storage Where the copies are kept, normally `localStorage`.
 * @param copies The copies, by place key.
 */
export function saveCopies(storage: CopyStorage, copies: Record<string, Copy>): void {
  try {
    storage.setItem(COPIES_KEY, JSON.stringify(copies));
  } catch (error) {
    console.log(`Weather Enhanced: the readings could not be kept, ${error}`);
  }
}

/**
 * Lets go of the copies of places the wearer switched off or removed, for a run that serves nothing
 * and so keeps no copies of its own. It writes only when there is a copy to let go of.
 *
 * @param storage Where the copies are kept, normally `localStorage`.
 * @param gone Whether a place, by its key, was switched off or removed.
 */
export function forgetCopies(storage: CopyStorage, gone: (key: string) => boolean): void {
  const kept = readCopies(storage);
  const left: Record<string, Copy> = {};

  Object.keys(kept).forEach((key) => {
    if (!gone(key)) {
      left[key] = kept[key];
    }
  });

  if (Object.keys(left).length !== Object.keys(kept).length) {
    saveCopies(storage, left);
  }
}

/** How old a copy is, or -1 when the clock was set back past it. */
function ageOf(copy: Copy, nowMs: number): number {
  const age = nowMs - copy.fetchedMs;

  return age >= 0 ? age : -1;
}

/**
 * Whether a copy can still be served without a fetch.
 *
 * A clock set back makes the copy look younger than nothing, which is no reason to keep serving it.
 *
 * @param copy The copy.
 * @param refreshMs The Refresh Interval.
 * @param nowMs The time now.
 * @return Whether it is still fresh.
 */
export function isFresh(copy: Copy, refreshMs: number, nowMs: number): boolean {
  const age = ageOf(copy, nowMs);

  return age >= 0 && age < refreshMs - EARLY_RUN_MS;
}

/**
 * Whether a copy can stand in for a place whose provider could not answer.
 *
 * Only a reading the picked provider made stands in. One that is itself an Open-Meteo failover would
 * be served for three intervals ahead of newer Open-Meteo readings, so it is served only while fresh.
 *
 * @param copy The copy.
 * @param provider The picked provider.
 * @param refreshMs The Refresh Interval.
 * @param nowMs The time now.
 * @return Whether it came from the picked provider and is under `COPY_LASTS_INTERVALS` Refresh Intervals old.
 */
export function standsIn(copy: Copy, provider: ProviderId, refreshMs: number, nowMs: number): boolean {
  const age = ageOf(copy, nowMs);

  return copy.reading.source === provider && age >= 0 && age < COPY_LASTS_INTERVALS * refreshMs;
}

/** When a place was last asked for, and of which provider and key. */
export interface Try {
  provider: ProviderId;
  /** The fingerprint of the API key, empty for Open-Meteo. */
  print: string;
  atMs: number;
}

/** Each place's last ask as a run holds it, read from storage once at the start of the run. */
export interface RunTries {
  /** The asks, by place key. */
  asks: Record<string, Try>;
  /** Whether the run let go of an ask that storage still holds. */
  unsaved: boolean;
}

/** Each place's last ask as kept, and none for anything that does not read back as one. */
function readTries(storage: CopyStorage): Record<string, Try> {
  const tries: Record<string, Try> = {};

  try {
    const saved = JSON.parse(storage.getItem(TRIES_KEY) || 'null');

    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      Object.keys(saved).forEach((key) => {
        const kept = saved[key];

        if (kept && typeof kept.provider === 'string' && typeof kept.print === 'string' && typeof kept.atMs === 'number' && Number.isFinite(kept.atMs)) {
          tries[key] = kept;
        }
      });
    }
  } catch {
    // unreadable, so every place can be asked for
  }

  return tries;
}

/** Keeps the run's asks in place of every one kept before. */
function writeTries(storage: CopyStorage, tries: RunTries): void {
  try {
    storage.setItem(TRIES_KEY, JSON.stringify(tries.asks));
    tries.unsaved = false;
  } catch (error) {
    console.log(`Weather Enhanced: the asks could not be kept, ${error}`);
  }
}

/**
 * Reads each place's last ask for a run, letting go of the places the wearer switched off or removed,
 * so such a place is asked for straight away once it is back rather than waiting out an ask from
 * before. A place missing from the run for any other reason keeps its ask. Nothing is written here,
 * so a run that asks for a place writes the asks only once.
 *
 * @param storage Where the asks are kept, normally `localStorage`.
 * @param gone Whether a place, by its key, was switched off or removed.
 * @return The run's asks.
 */
export function openTries(storage: CopyStorage, gone: (key: string) => boolean): RunTries {
  const read = readTries(storage);
  const asks: Record<string, Try> = {};

  Object.keys(read).forEach((key) => {
    if (!gone(key)) {
      asks[key] = read[key];
    }
  });

  return { asks, unsaved: Object.keys(asks).length !== Object.keys(read).length };
}

/**
 * Notes that places were just asked for and keeps the run's asks. It is kept as the ask goes out,
 * since the Pebble app can end a run partway.
 *
 * @param storage Where the asks are kept, normally `localStorage`.
 * @param tries The run's asks, which take the new ones.
 * @param asked The places just asked for.
 * @param tried The provider and key fingerprint asked, and when.
 */
export function noteTries(storage: CopyStorage, tries: RunTries, asked: string[], tried: Try): void {
  asked.forEach((key) => (tries.asks[key] = tried));
  writeTries(storage, tries);
}

/**
 * Keeps the run's asks at the end of a run that let go of one and has not kept them since. A run that
 * let go of nothing writes nothing here.
 *
 * @param storage Where the asks are kept, normally `localStorage`.
 * @param tries The run's asks.
 */
export function closeTries(storage: CopyStorage, tries: RunTries): void {
  if (tries.unsaved) {
    writeTries(storage, tries);
  }
}

/**
 * Whether a place was asked of this provider and key inside the Refresh Interval, so it is not asked
 * again yet. A clock set back before the ask lets the place be asked.
 *
 * @param tried The place's last ask, or none.
 * @param provider The picked provider.
 * @param print The fingerprint of the key in use.
 * @param refreshMs The Refresh Interval.
 * @param nowMs The time now.
 * @return Whether the place is held until the Refresh Interval.
 */
export function triedLately(tried: Try | undefined, provider: ProviderId, print: string, refreshMs: number, nowMs: number): boolean {
  if (!tried || tried.provider !== provider || tried.print !== print) {
    return false;
  }

  const age = nowMs - tried.atMs;

  return age >= 0 && age < refreshMs - EARLY_RUN_MS;
}
