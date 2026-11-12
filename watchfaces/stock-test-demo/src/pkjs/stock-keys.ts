/**
 * The stock face's own keys, and the strip unpacked for the log.
 *
 * The framework packs the first four quotes into the strip the watch reads, and a ticker the plugin
 * has no price for keeps its slot with the plugin's word for why in place of its ticker. So the report
 * carries the tickers on their own, slot by slot, and the watch can say which one failed.
 */

import wire, { WIRE_CAPS } from '../../paf/ts/pkjs/wire';
import { instancesOf, propertiesOf, text } from '../../paf/ts/plugin-shapes/shapes';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';

/** One slot of a strip, as the watch will read it. */
export interface StripSlot {
  ok: boolean;
  label: string;
  priceCents: number;
  changeHundredths: number;
}

/**
 * The tickers in the order the strip holds them.
 *
 * The strip takes the first four instances that carry any properties, in the plugin's order, and
 * names each by its ticker, then its instance id, then its name. This follows the same rule, so slot
 * by slot the two line up. The framework's own stocksFromUpdate holds the rule, but it lives in
 * plugin-sources/stocks.ts, and the build refuses a face that imports past the plugin-sources index.
 *
 * @param envelope The plugin's update.
 * @return The tickers, in ASCII and no longer than the watch's label.
 */
export function tickerLabels(envelope: SourceEnvelope): string[] {
  const labels: string[] = [];

  for (const instance of instancesOf(envelope)) {
    const properties = propertiesOf(instance);

    if (!properties || Object.keys(properties).length === 0) {
      continue;
    }

    const id = typeof instance.instanceId === 'string' ? instance.instanceId.trim() : '';
    const ticker = (text(properties.ticker, 'short') || '').trim() || id || (text(properties.name, 'short') || '').trim();

    labels.push(wire.toAscii(ticker.toUpperCase(), WIRE_CAPS.STOCK_LABEL_MAX));

    if (labels.length === WIRE_CAPS.STOCK_SLOTS_MAX) {
      break;
    }
  }

  return labels;
}

/**
 * Builds the face's own keys for the report: the tickers, one per line.
 *
 * @param envelope The plugin's last update, or null before one, which adds nothing.
 * @param messageKeys The face's message keys, by name.
 * @return The keys to add to the report.
 */
export function stockExtras(envelope: SourceEnvelope | null, messageKeys: Record<string, number>): AppMessageDict {
  if (!envelope) {
    return {};
  }

  return { [messageKeys.TEST_TICKERS]: tickerLabels(envelope).join('\n') };
}

/** Reads a little endian number of a few bytes, signed. */
function signedAt(bytes: ArrayLike<number>, at: number, count: number): number {
  let value = 0;

  for (let index = count - 1; index >= 0; index--) {
    value = value * 256 + (bytes[at + index] & 0xff);
  }

  const top = Math.pow(2, count * 8);

  return value >= top / 2 ? value - top : value;
}

/**
 * Unpacks a packed stock strip: a count, then each slot as an ok byte, the price in cents as four bytes,
 * the change in hundredths of a percent as two, and a length byte before the label.
 *
 * @param bytes The strip as the phone hands it to the watch.
 * @return The slots, or null when the bytes run out before the count says they should.
 */
export function decodeStrip(bytes: ArrayLike<number>): StripSlot[] | null {
  if (bytes.length < 1) {
    return null;
  }

  const slots: StripSlot[] = [];
  let at = 1;

  for (let index = 0; index < bytes[0]; index++) {
    if (at + 8 > bytes.length || at + 8 + bytes[at + 7] > bytes.length) {
      return null;
    }

    const length = bytes[at + 7];
    let label = '';

    for (let char = 0; char < length; char++) {
      label += String.fromCharCode(bytes[at + 8 + char]);
    }

    slots.push({ ok: bytes[at] === 1, label, priceCents: signedAt(bytes, at + 1, 4), changeHundredths: signedAt(bytes, at + 5, 2) });
    at += 8 + length;
  }

  return slots;
}

/**
 * Writes a strip on its way to the watch, one line per slot, such as `slot 0: AAPL 261.74 +1.25%`.
 *
 * @param name The key's name.
 * @param value The key's value.
 * @return The lines for the log, or undefined for any key but the strip.
 */
export function describeStrip(name: string, value: number | string | number[]): string[] | undefined {
  if (name !== 'STOCK_STRIP' || !Array.isArray(value)) {
    return undefined;
  }

  const slots = decodeStrip(value);

  if (!slots) {
    return [`STOCK_STRIP ${value.length} bytes that do not unpack`];
  }

  return [`STOCK_STRIP ${slots.length} slots`].concat(
    slots.map((slot, index) => {
      if (!slot.ok) {
        return `  slot ${index}: status ${slot.label}`;
      }

      const sign = slot.changeHundredths > 0 ? '+' : '';

      return `  slot ${index}: ${slot.label} ${(slot.priceCents / 100).toFixed(2)} ${sign}${(slot.changeHundredths / 100).toFixed(2)}%`;
    })
  );
}
