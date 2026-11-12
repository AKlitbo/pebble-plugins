/**
 * Specs for the stock face's own keys and the strip it logs.
 *
 * The tickers only help the watch if they line up with the strip slot by slot, so the rule for which
 * instances take a slot is worth pinning. The strip's byte layout is what the log unpacks, and a wrong
 * offset would log a price the watch never showed.
 */
import { describe, expect, test } from 'vitest';
import { decodeStrip, describeStrip, tickerLabels } from './stock-keys';

describe('tickerLabels', () => {
  /** An instance with no properties takes no slot, so counting it would shift every ticker after it. */
  test('skips an instance with no properties, as the strip does', () => {
    const envelope = {
      instances: [
        { instanceId: 'a', properties: { ticker: { shortText: { text: 'aapl' } } } },
        { instanceId: 'b', properties: {} },
        { instanceId: 'msft', properties: { price: { numericValue: { value: 400 } } } },
      ],
    };

    const result = tickerLabels(envelope);

    expect(result).toEqual(['AAPL', 'MSFT']);
  });

  /** The strip holds four, so a fifth ticker would name a slot the watch does not have. */
  test('stops at the four slots the strip holds', () => {
    const instances = ['A', 'B', 'C', 'D', 'E'].map((ticker) => ({ properties: { ticker: { shortText: { text: ticker } } } }));

    const result = tickerLabels({ instances });

    expect(result).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('decodeStrip', () => {
  /** A wrong offset would log a price or a change the watch never showed. */
  test('reads a slot with a negative change', () => {
    const bytes = [1, 1, 0x3e, 0x66, 0, 0, 0x83, 0xff, 4, 65, 65, 80, 76];

    const result = decodeStrip(bytes);

    expect(result).toEqual([{ ok: true, label: 'AAPL', priceCents: 26174, changeHundredths: -125 }]);
  });

  /** A strip that stops short is what the watch refuses, so the log has to say so rather than guess. */
  test('refuses a strip that claims more slots than it carries', () => {
    const result = decodeStrip([2, 1, 0x3e, 0x66, 0, 0, 0x83, 0xff, 4, 65, 65, 80, 76]);

    expect(result).toBeNull();
  });
});

describe('describeStrip', () => {
  /** A failed slot carries its status in place of the ticker, and the log has to read it as one. */
  test('writes a failed slot as its status', () => {
    const bytes = [1, 0, 0, 0, 0, 0, 0, 0, 9, 78, 79, 32, 80, 76, 85, 71, 73, 78];

    const result = describeStrip('STOCK_STRIP', bytes);

    expect(result).toEqual(['STOCK_STRIP 1 slots', '  slot 0: status NO PLUGIN']);
  });
});
