/**
 * Specs for what the plugin watch writes and reports.
 *
 * The log is how a test on a real phone gets read, so a line that drops a shape, a unit, or an
 * instance hides exactly what the test is after. The report is what names the plugin on the watch, so
 * naming the right plugin, and saying when none serves the face, is worth pinning too. So is the
 * feature's own state: which subscription counts, which list it trusts, and when the report goes again.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSendQueue, SEND_RETRIES, SEND_RETRY_MS } from '../../paf/ts/pkjs/send-queue';
import type { PluginSummary } from '../../paf/ts/plugin-sources/types';
import { describeEnvelope, describePlugins, describeProperty, describeSend, errorCode, keyNames, NO_PLUGIN, pluginLabel, pluginName, reportDict, servesKind, watchPlugin } from './plugin-watch';

const WEATHER_ENHANCED = 'f62c8e74-dd3c-4157-abf0-9a49aaaaaaaa';

const PLUGINS: PluginSummary[] = [
  { uuid: WEATHER_ENHANCED, name: 'Weather Enhanced', sources: [{ category: 'weather', items: ['location'] }] },
  { uuid: 'c6b7d0a7-32b5-47f2-9839-becd04965da2', name: 'Calendar + iCal', sources: [{ category: 'calendar', items: ['event'] }] },
];

describe('describeProperty', () => {
  /** A pressure without its unit would leave the log unable to say whether the plugin sent hPa or inHg. */
  test('writes a single value with its unit', () => {
    const result = describeProperty('pressure', { numericValue: { value: 1013.2, unit: 'hPa' } });

    expect(result).toBe('pressure: numericValue 1013.2 hPa');
  });

  /** A series has to show where it starts, or the log cannot say which point is the hour now. */
  test('writes a series with its start, its step, and its first points', () => {
    const series = { start: 1794528000, stepSec: 3600, numericValue: { unit: '°C', values: [4, 5, null, 6, 7, 8, 9, 10] } };

    const result = describeProperty('hourly_dew_point', { series });

    expect(result).toBe('hourly_dew_point: series from 2026-11-13T00:00:00.000Z every 3600s, numericValue °C [4, 5, null, 6, ... 8 in all]');
  });

  /** A property sent in two shapes has to show both, since a face may read either one. */
  test('writes every shape a property carries', () => {
    const result = describeProperty('starts_at', { shortText: { text: '9:30' }, timestamp: { value: 1794528000 } });

    expect(result).toBe('starts_at: shortText "9:30" | timestamp 1794528000 2026-11-13T00:00:00.000Z');
  });
});

describe('describeEnvelope', () => {
  /**
   * The Pebble app's log drops and reorders lines when too many arrive at once, so only the first place
   * goes out in full and every other one gets a line of its own that still tells it apart.
   */
  test('writes the first instance in full and each later one on one line', () => {
    const envelope = {
      pluginUuid: WEATHER_ENHANCED,
      validUntilMs: 1794528000000,
      instances: [
        { instanceId: 'home', properties: { name: { shortText: { text: 'Buckeye' } }, temperature: { numericValue: { value: 28, unit: '°C' } } } },
        { instanceId: 'work', properties: { name: { shortText: { text: 'Brockville' } }, temperature: { numericValue: { value: 6, unit: '°C' } } } },
      ],
    };

    const result = describeEnvelope(envelope, 'update', ['name']);

    expect(result).toEqual([
      'update',
      '  validUntilMs 1794528000000 2026-11-13T00:00:00.000Z, 2 instances',
      '  instance 0: id "home", 2 properties',
      '    name: shortText "Buckeye"',
      '    temperature: numericValue 28 °C',
      '  instance 1: id "work", name: shortText "Brockville", 2 properties',
    ]);
  });

  /** A plugin that sends no expiry has to read as none, not as a bad date. */
  test('writes a missing validUntilMs as it came', () => {
    const result = describeEnvelope({ validUntilMs: null, instances: [] }, 'update', ['name']);

    expect(result[1]).toBe('  validUntilMs null, 0 instances');
  });
});

describe('describePlugins', () => {
  /** The launch list is how a tester sees which plugins the phone has and what each one serves. */
  test('writes each plugin with its uuid and what it serves', () => {
    const result = describePlugins(PLUGINS);

    expect(result).toEqual([
      'the phone lists 2 plugins',
      `  Weather Enhanced ${WEATHER_ENHANCED}: serves weather/location`,
      '  Calendar + iCal c6b7d0a7-32b5-47f2-9839-becd04965da2: serves calendar/event',
    ]);
  });
});

describe('servesKind', () => {
  /** With nothing serving the kind the framework never subscribes, so this is the only way the watch hears. */
  test('finds no plugin for a kind nothing on the list serves', () => {
    const result = servesKind(PLUGINS, 'finance', 'stock');

    expect(result).toBe(false);
  });

  /** A plugin serving the kind has to count, or the watch would read as having no plugin. */
  test('finds the plugin serving a kind', () => {
    const result = servesKind(PLUGINS, 'calendar', 'event');

    expect(result).toBe(true);
  });
});

describe('pluginLabel and pluginName', () => {
  /** The log names a plugin by name and uuid, so two plugins of the same name still tell apart. */
  test('labels a listed plugin by name and uuid for the log', () => {
    const result = pluginLabel(PLUGINS, WEATHER_ENHANCED);

    expect(result).toBe(`Weather Enhanced ${WEATHER_ENHANCED}`);
  });

  /** The watch fonts only carry ASCII, so a plugin name with an accent would show a box. */
  test('names a plugin for the watch in ASCII', () => {
    const plugins = [{ uuid: 'abc', name: 'Météo' }];

    const result = pluginName(plugins, 'abc');

    expect(result).toBe('Meteo');
  });

  /** A plugin installed after the list was read still needs telling apart on the watch. */
  test('names an unlisted plugin by the start of its uuid', () => {
    const result = pluginName(PLUGINS, '0123456789abcdef');

    expect(result).toBe('01234567');
  });
});

describe('errorCode', () => {
  /** The phone's code is what the watch shows in place of the data. */
  test('reads the code off an error', () => {
    const result = errorCode({ code: 'PLUGIN_UNAVAILABLE', message: 'gone' });

    expect(result).toBe('PLUGIN_UNAVAILABLE');
  });

  /** An error with no code still has to replace the data, or the watch would show old readings as current. */
  test('reads an error with no code as UNKNOWN', () => {
    const result = errorCode({ message: 'gone' });

    expect(result).toBe('UNKNOWN');
  });
});

describe('describeSend', () => {
  /** A message logged by key number alone would leave the log unreadable. */
  test('writes each key by name with its value', () => {
    const names = keyNames({ TEST_PLUGIN: 10, TEST_ERROR: 11 });

    const result = describeSend({ 10: 'Weather Enhanced', 11: '' }, names);

    expect(result).toEqual(['to the watch, 2 keys', '  TEST_PLUGIN="Weather Enhanced"', '  TEST_ERROR=""']);
  });

  /** A packed strip says much more unpacked, so the face's own writer wins over the byte count. */
  test('lets the face write a packed value its own way', () => {
    const names = keyNames({ STOCK_STRIP: 10, TEST_ERROR: 11 });
    const unpack = (name: string) => (name === 'STOCK_STRIP' ? ['STOCK_STRIP slot 0: AAPL'] : undefined);

    const result = describeSend({ 10: [1, 2, 3], 11: '' }, names, unpack);

    expect(result).toEqual(['to the watch, 2 keys', '  STOCK_STRIP slot 0: AAPL', '  TEST_ERROR=""']);
  });
});

describe('reportDict', () => {
  /** The empty error is what clears an old error off the watch once an update lands. */
  test('carries the plugin, an empty error, and the face keys', () => {
    const result = reportDict({ TEST_PLUGIN: 10, TEST_ERROR: 11 }, 'Weather Enhanced', '', { 12: 'Toronto' });

    expect(result).toEqual({ 10: 'Weather Enhanced', 11: '', 12: 'Toronto' });
  });
});

/** The face's keys for the specs below, by name. */
const KEYS = { TEST_PLUGIN: 10, TEST_ERROR: 11, WEATHER_REQUEST: 20, WEATHER_TEMPERATURE: 21 };

/** A subscription the fake phone took, with the callbacks the feature wrapped around the framework's. */
interface Taken {
  onData(envelope: unknown): void;
  onError(error: unknown): void;
}

/** What the fake phone lets a spec change, and what it saw. */
interface FakePhone {
  list: unknown;
  listThrows: boolean;
  nack: boolean;
  sent: AppMessageDict[];
  taken: Taken[];
}

/**
 * Puts a fake phone in place of Pebble, with a plugin list the spec can change or make throw, and a
 * send the spec can make nack.
 */
function fakePhone(list: PluginSummary[]): FakePhone {
  const phone: FakePhone = { list, listThrows: false, nack: false, sent: [], taken: [] };
  const bridge = {
    sendAppMessage(dict: AppMessageDict, onOk?: () => void, onFail?: () => void) {
      phone.sent.push(dict);
      (phone.nack ? onFail : onOk)?.();
    },
    enumeratePlugins() {
      if (phone.listThrows) {
        throw new Error('busy');
      }

      return phone.list;
    },
    subscribeToSource(request: Taken) {
      phone.taken.push(request);

      return { unsubscribe() {} };
    },
    addEventListener() {},
    openURL() {},
  };

  (globalThis as { Pebble?: unknown }).Pebble = bridge;

  return phone;
}

/**
 * Starts the feature on a fake phone the way startPebbleApp does, with the framework's own send queue,
 * and runs its ready.
 */
function readyWatch(list: PluginSummary[], options: Partial<Parameters<typeof watchPlugin>[0]> = {}) {
  const phone = fakePhone(list);
  const queueSend = createSendQueue((dict, onOk, onFail) => Pebble.sendAppMessage(dict, onOk, onFail));
  const feature = watchPlugin({ name: 'weather-test-demo', category: 'weather', item: 'location', summary: ['name'], ...options });
  const hooks = feature({ messageKeys: KEYS, defaults: {}, queueSend, refetchDelayMs: 0, providers: null });

  hooks.ready?.();

  return { phone, hooks };
}

/** Subscribes the way the framework does, and hands back what the phone took. */
function subscribe(phone: FakePhone, category = 'weather', item = 'location'): Taken {
  Pebble.subscribeToSource?.({ category, item, properties: [], onData() {}, onError() {} });

  return phone.taken[phone.taken.length - 1];
}

/** The reports the watch was sent, leaving out every other message. */
function reports(phone: FakePhone): AppMessageDict[] {
  return phone.sent.filter((dict) => dict[KEYS.TEST_ERROR] !== undefined);
}

const WEATHER_A = { uuid: 'aaaa1111', name: 'Weather A', sources: [{ category: 'weather', items: ['location'] }] };

describe('watchPlugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as { Pebble?: unknown }).Pebble;
  });

  /** The framework drops an update from a subscription it has replaced, so the header has to as well. */
  test('ignores an update from a subscription the framework has replaced', () => {
    const { phone } = readyWatch([WEATHER_A]);
    const [older] = [subscribe(phone), subscribe(phone)];
    const before = reports(phone).length;

    older.onData({ pluginUuid: WEATHER_A.uuid, instances: [] });

    expect(reports(phone)).toHaveLength(before);
  });

  /** A list read that throws once would otherwise leave every plugin unnamed until the next good one. */
  test('keeps the plugin list through a read that throws', () => {
    const { phone } = readyWatch([WEATHER_A]);
    const taken = subscribe(phone);

    phone.listThrows = true;
    taken.onData({ pluginUuid: 'not-on-the-list', instances: [] });

    taken.onData({ pluginUuid: WEATHER_A.uuid, instances: [] });

    expect(reports(phone).pop()).toEqual({ 10: 'Weather A', 11: '' });
  });

  /** A plugin removed after launch has to read as none on the watch, not as the last good reading. */
  test('reports NO_PLUGIN once a plugin goes, at the next watch ask', () => {
    const { phone, hooks } = readyWatch([WEATHER_A]);

    phone.list = [];

    hooks.message?.({ [KEYS.WEATHER_REQUEST]: 1 });

    expect(reports(phone).pop()).toEqual({ 10: '', 11: NO_PLUGIN });
  });

  /** A plugin installed after launch has to clear NO_PLUGIN, or the watch shows an error that is over. */
  test('clears NO_PLUGIN once a plugin appears, at the next watch ask', () => {
    const { phone, hooks } = readyWatch([]);

    phone.list = [WEATHER_A];

    hooks.message?.({ [KEYS.WEATHER_REQUEST]: 1 });

    expect(reports(phone).pop()).toEqual({ 10: '', 11: '' });
  });

  /** A report that never reached the watch has to go again, or the header stays blank for good. */
  test('sends a report again at the next watch ask after it failed', () => {
    const { phone, hooks } = readyWatch([WEATHER_A]);
    const taken = subscribe(phone);

    phone.nack = true;
    taken.onData({ pluginUuid: WEATHER_A.uuid, instances: [] });
    vi.advanceTimersByTime(SEND_RETRY_MS * SEND_RETRIES);
    phone.nack = false;
    const before = reports(phone).length;

    hooks.message?.({ [KEYS.WEATHER_REQUEST]: 1 });

    expect(reports(phone).slice(before)).toEqual([{ 10: 'Weather A', 11: '' }]);
  });

  /** The weather face also subscribes to the Pebble app's units, which must not name the weather plugin. */
  test('leaves the report alone for an update of another kind', () => {
    const { phone } = readyWatch([WEATHER_A]);
    const units = subscribe(phone, 'preferences', 'units');
    const before = reports(phone).length;

    units.onData({ pluginUuid: WEATHER_A.uuid, instances: [] });

    expect(reports(phone)).toHaveLength(before);
  });

  /** A slip in the face's own code must never cost the watch the framework's message. */
  test('still sends the message when the face reading it throws', () => {
    const broken = () => {
      throw new Error('broken');
    };
    const { phone } = readyWatch([WEATHER_A], { noticeSend: broken });

    Pebble.sendAppMessage({ [KEYS.WEATHER_TEMPERATURE]: 4 });

    expect(phone.sent).toContainEqual({ 21: 4 });
  });
});
