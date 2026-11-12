/**
 * The framework's ledger, kept for each provider a run fetches from.
 *
 * A run with OpenWeatherMap or WeatherAPI.com makes one call to that provider for each place, and one
 * Open-Meteo request for the series of every place, which Open-Meteo counts at `READING_WEIGHT` a place.
 * The providers' `fetchReading` says so through its send hook as each request goes out, and the hook
 * stamps it then and saves at once, since the Pebble app can end a run partway through. A request that
 * never left the phone spent nothing, so its stamps come back off.
 */

import { addStamp, allowance, ledgerPrint, loadStamps, saveStamps, takeBack } from '../../paf/ts/quota/ledger';
import type { QuotaPlan, Stamp } from '../../paf/ts/quota/ledger';
import { NETWORK_ERROR } from '../../paf/ts/pkjs/request';
import type { SendHook } from '../../paf/ts/pkjs/request';
import { READING_WEIGHT as OPEN_METEO_WEIGHT } from '../../paf/ts/weather/providers/openmeteo';
import { LEDGER_KEY, QUOTA_PLANS } from '../limits';
import type { ProviderId } from '../settings';

/** The part of `localStorage` the ledger uses, which a spec stands in for. */
export type MeterStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** One provider's ledger for a run. */
export interface Meter {
  provider: ProviderId;
  plan: QuotaPlan;
  /** The fingerprint the stamps are kept under. */
  print: string;
  /** Whether its calls are counted, which a paid plan turns off. */
  counted: boolean;
  stamps: Stamp[];
}

// OpenWeatherMap and WeatherAPI.com each count a call as 1, which is their own READING_WEIGHT
const KEYED_WEIGHT = 1;

/**
 * Opens a provider's ledger for a run.
 *
 * @param storage Where the ledger is kept, normally `localStorage`.
 * @param provider The provider.
 * @param key The API key in use, or empty for none.
 * @param paid Whether the key is on a paid plan, which counts nothing.
 * @param nowMs The time now.
 * @return The provider's ledger.
 */
export function openMeter(storage: MeterStorage, provider: ProviderId, key: string, paid: boolean, nowMs: number): Meter {
  const plan = QUOTA_PLANS[provider];
  const print = ledgerPrint(plan, key);

  return { provider, plan, print, counted: !paid, stamps: paid ? [] : loadStamps(storage, LEDGER_KEY, provider, print, plan, nowMs) };
}

/**
 * How many places a provider has room for now.
 *
 * @param meter The provider's ledger.
 * @param places How many places the run wants to fetch.
 * @param nowMs The time now.
 * @return How many of them fit inside its plan.
 */
export function roomFor(meter: Meter, places: number, nowMs: number): number {
  const weight = meter.provider === 'openmeteo' ? OPEN_METEO_WEIGHT : KEYED_WEIGHT;

  return allowance(meter.plan, meter.stamps, { calls: places, weight, paid: !meter.counted }, nowMs).room;
}

/** Stamps a request's calls, or takes them back off, and saves the ledger. */
function mark(storage: MeterStorage, meter: Meter, atMs: number, calls: number, weight: number, add: boolean): void {
  if (!meter.counted) {
    return;
  }

  for (let call = 0; call < calls; call++) {
    if (add) {
      addStamp(meter.stamps, atMs, weight);
    } else {
      takeBack(meter.stamps, atMs, weight);
    }
  }

  saveStamps(storage, LEDGER_KEY, meter.provider, meter.print, meter.stamps, meter.plan, atMs);
}

/**
 * A send hook that stamps each request in its provider's ledger as it goes out, and takes the stamps
 * back off when the request never left the phone. A request to a provider with no ledger this run
 * stamps nothing.
 *
 * @param storage Where the ledger is kept, normally `localStorage`.
 * @param meters The ledgers of the providers the run fetches from.
 * @param clock Reads the time now.
 * @return The hook, for the last argument of `fetchReading`.
 */
export function stampSends(storage: MeterStorage, meters: Meter[], clock: () => number): SendHook {
  return (send) => {
    const meter = meters.find((each) => each.provider === send.source);

    if (!meter) {
      return;
    }

    const atMs = clock();

    mark(storage, meter, atMs, send.calls, send.weight, true);

    return (err) => {
      if (err === NETWORK_ERROR) {
        mark(storage, meter, atMs, send.calls, send.weight, false);
      }
    };
  };
}
