/**
 * Watching a Pebble app plugin from the phone, for the test faces.
 *
 * The framework's feature reads the plugin and sends the watch what it makes of each update, and gives
 * a face no look at the update on the way. So this feature wraps the bridge's own calls. The wrapped
 * Pebble.subscribeToSource logs every update and error a plugin sends, property by property, before the
 * framework reads it. The wrapped Pebble.sendAppMessage logs every message going to the watch, key by
 * key, and whether the watch acked it.
 *
 * After each update or error for the face's own kind it also sends the watch a short report: which
 * plugin answered, its error if it sent one, and any keys of the face's own. The watch shows the report
 * in its header. Only the newest subscription to the kind counts, as in the framework, and each ask
 * from the watch checks the plugin list again and sends the report again.
 *
 * The three test faces keep the same copy of this file, since a paf unit only builds what sits inside
 * its own folder. A fix to one copy goes into the other two.
 */

import type { Feature } from '../../paf/ts/pkjs/feature';
import { createDedupedSender } from '../../paf/ts/pkjs/send-queue';
import wire from '../../paf/ts/pkjs/wire';
import type { PluginSummary, SourceEnvelope, SourceProperty } from '../../paf/ts/plugin-sources/types';
import { createLog } from './log-lines';

/** How many points of a series are written out before the rest are only counted. */
const SERIES_SHOWN = 4;

/** How long a plugin name the watch holds, one short of its 32 byte buffer. */
export const PLUGIN_NAME_MAX = 31;

/** How long an error code the watch holds, one short of its 32 byte buffer. */
export const ERROR_MAX = 31;

/**
 * The error the report carries when nothing on the phone serves the face's kind. The phone has no
 * code for that, since the framework never subscribes then, so this one is ours.
 */
export const NO_PLUGIN = 'NO_PLUGIN';

/** A value on its way to the watch. */
export type WatchValue = number | string | number[];

/** What a face hands the feature. */
export interface WatchOptions {
  /** The face's name, which every log line starts with, such as `weather-test-demo`. */
  name: string;
  /** The category the face reads, such as `weather`. */
  category: string;
  /** The item the face reads, such as `location`. */
  item: string;
  /** The properties the log writes an instance after the first by, such as `name`. */
  summary: string[];
  /**
   * The face's own keys to add to the report, worked out from the last update, or from null before
   * one. Left out, the report carries the plugin and the error alone.
   */
  extras?(latest: SourceEnvelope | null, messageKeys: Record<string, number>, nowMs: number): AppMessageDict;
  /**
   * Writes one value going to the watch as log lines, or undefined to leave it to the plain form. A
   * packed strip says much more unpacked than as a count of bytes.
   */
  describeValue?(name: string, value: WatchValue): string[] | undefined;
  /**
   * Reads a message on its way to the watch, and says whether it changed what extras writes, such as
   * the order of an agenda's events. The report goes again after a message that did.
   */
  noticeSend?(dict: AppMessageDict, messageKeys: Record<string, number>): boolean;
}

/** What subscribeToSource is handed, as far as the feature reads it. */
interface SubscribeRequest {
  category?: string;
  item?: string;
  properties?: string[];
  onData?: (envelope: unknown) => void;
  onError?: (error: unknown) => void;
}

/** Reads anything the phone hands over as an update, with every field possibly missing. */
function asEnvelope(raw: unknown): SourceEnvelope {
  return (raw && typeof raw === 'object' ? raw : {}) as SourceEnvelope;
}

/** Writes a moment in epoch seconds as an ISO time, or says it is not one. */
function isoFromSeconds(seconds: unknown): string {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : `bad time ${String(seconds)}`;
}

/** Writes the first few values of a list and how many there are in all. */
function someValues(values: unknown): string {
  if (!Array.isArray(values)) {
    return 'no values';
  }

  const shown = values.slice(0, SERIES_SHOWN).map((value) => JSON.stringify(value));
  const more = values.length > SERIES_SHOWN ? `, ... ${values.length} in all` : '';

  return `[${shown.join(', ')}${more}]`;
}

/**
 * Writes one property of an update the way it came, every shape it carries.
 *
 * A single value comes out with its unit, such as `pressure: numericValue 1013.2 hPa`. A series comes
 * out with its start, its step, and its first few points.
 *
 * @param name The property's name, such as `dew_point`.
 * @param property The property as the plugin sent it.
 * @return The line for the log.
 */
export function describeProperty(name: string, property: SourceProperty | undefined): string {
  if (!property || typeof property !== 'object') {
    return `${name}: ${JSON.stringify(property)}`;
  }

  const parts: string[] = [];

  if (property.shortText) {
    parts.push(`shortText ${JSON.stringify(property.shortText.text)}`);
  }

  if (property.longText) {
    parts.push(`longText ${JSON.stringify(property.longText.text)}`);
  }

  if (property.numericValue) {
    const { value, unit, min, max } = property.numericValue;
    const range = min !== undefined || max !== undefined ? ` (min ${String(min)} max ${String(max)})` : '';

    parts.push(`numericValue ${String(value)}${unit ? ` ${unit}` : ''}${range}`);
  }

  if (property.timestamp) {
    parts.push(`timestamp ${String(property.timestamp.value)} ${isoFromSeconds(property.timestamp.value)}`);
  }

  if (property.boolean) {
    parts.push(`boolean ${String(property.boolean.value)}`);
  }

  if (property.series) {
    const series = property.series;
    const inner: string[] = [];

    if (series.numericValue) {
      inner.push(`numericValue${series.numericValue.unit ? ` ${series.numericValue.unit}` : ''} ${someValues(series.numericValue.values)}`);
    }

    if (series.shortText) {
      inner.push(`shortText ${someValues(series.shortText.values)}`);
    }

    if (series.longText) {
      inner.push(`longText ${someValues(series.longText.values)}`);
    }

    if (series.timestamp) {
      inner.push(`timestamp ${someValues(series.timestamp.values)}`);
    }

    parts.push(`series from ${isoFromSeconds(series.start)} every ${String(series.stepSec)}s, ${inner.join(', ') || 'no shapes'}`);
  }

  return `${name}: ${parts.join(' | ') || `no shapes it knows, ${JSON.stringify(property)}`}`;
}

/**
 * Writes a whole update: the line it opens with, how long it holds, then the first instance with every
 * property it carries, and one line for each instance after it.
 *
 * The Pebble app's log drops and reorders lines when too many arrive at once, and three weather places
 * of 28 properties each was enough to lose some. So only the first instance goes out in full, and the
 * rest go by the few properties that tell them apart.
 *
 * @param raw The update as the plugin sent it, which may be missing or carry anything.
 * @param heading The first line, saying when the update came and from which plugin.
 * @param summary The properties a later instance is written with, such as `name`.
 * @return The lines for the log.
 */
export function describeEnvelope(raw: unknown, heading: string, summary: string[]): string[] {
  const envelope = asEnvelope(raw);
  const instances = Array.isArray(envelope.instances) ? envelope.instances : [];
  const until = envelope.validUntilMs;
  const validUntil = typeof until === 'number' && Number.isFinite(until) ? `${until} ${new Date(until).toISOString()}` : String(until);
  const lines = [heading, `  validUntilMs ${validUntil}, ${instances.length} instances`];

  instances.forEach((instance, index) => {
    const properties = instance && instance.properties && typeof instance.properties === 'object' ? instance.properties : {};
    const names = Object.keys(properties);
    const id = JSON.stringify(instance ? instance.instanceId : instance);

    if (index > 0) {
      const named = summary.filter((name) => properties[name] !== undefined).map((name) => describeProperty(name, properties[name]));

      lines.push(`  instance ${index}: id ${id}, ${named.concat(`${names.length} properties`).join(', ')}`);
      return;
    }

    lines.push(`  instance 0: id ${id}, ${names.length} properties`);
    names.forEach((name) => lines.push(`    ${describeProperty(name, properties[name])}`));
  });

  return lines;
}

/** Reads a plugin list off the phone into plugins, dropping anything that is not one. */
function pluginsIn(list: unknown): PluginSummary[] {
  return Array.isArray(list) ? list.filter((plugin): plugin is PluginSummary => Boolean(plugin) && typeof plugin === 'object') : [];
}

/**
 * Writes every plugin the phone lists, with its uuid and each kind it serves.
 *
 * @param list What Pebble.enumeratePlugins handed back.
 * @return The lines for the log.
 */
export function describePlugins(list: unknown): string[] {
  if (!Array.isArray(list)) {
    return [`the phone's plugin list is not a list: ${JSON.stringify(list)}`];
  }

  const plugins = pluginsIn(list);
  const lines = [`the phone lists ${plugins.length} plugins`];

  plugins.forEach((plugin) => {
    const serves = (Array.isArray(plugin.sources) ? plugin.sources : []).map((source) => `${String(source.category)}/${(source.items || []).join('+')}`);

    lines.push(`  ${String(plugin.name)} ${String(plugin.uuid)}: serves ${serves.join(', ') || 'nothing'}`);
  });

  return lines;
}

/**
 * Whether a plugin on the list serves one kind.
 *
 * @param plugins The phone's plugins.
 * @param category The category, such as `calendar`.
 * @param item The item, such as `event`.
 * @return True when one does.
 */
export function servesKind(plugins: PluginSummary[], category: string, item: string): boolean {
  return plugins.some((plugin) => (Array.isArray(plugin.sources) ? plugin.sources : []).some((source) => source.category === category && Array.isArray(source.items) && source.items.indexOf(item) !== -1));
}

/** The plugin on the list with this uuid, or undefined. */
function findPlugin(plugins: PluginSummary[], uuid: unknown): PluginSummary | undefined {
  return typeof uuid === 'string' ? plugins.find((plugin) => plugin.uuid === uuid) : undefined;
}

/**
 * Names the plugin behind an update for the log, by name and uuid both.
 *
 * @param plugins The phone's plugins.
 * @param uuid The uuid the update carried.
 * @return Such as `Weather Enhanced f62c8e74-...`, or the uuid alone for a plugin the list leaves out.
 */
export function pluginLabel(plugins: PluginSummary[], uuid: unknown): string {
  const plugin = findPlugin(plugins, uuid);

  if (typeof uuid !== 'string' || !uuid) {
    return 'a plugin with no uuid';
  }

  return plugin && plugin.name ? `${plugin.name} ${uuid}` : `an unlisted plugin ${uuid}`;
}

/**
 * Names the plugin behind an update for the watch, in the ASCII its fonts carry.
 *
 * @param plugins The phone's plugins.
 * @param uuid The uuid the update carried.
 * @return The plugin's name, the start of its uuid for one the list leaves out, or empty for no uuid.
 */
export function pluginName(plugins: PluginSummary[], uuid: unknown): string {
  const plugin = findPlugin(plugins, uuid);

  if (plugin && typeof plugin.name === 'string' && plugin.name.trim()) {
    return wire.toAscii(plugin.name.trim(), PLUGIN_NAME_MAX);
  }

  return typeof uuid === 'string' ? uuid.slice(0, 8) : '';
}

/**
 * Reads the code off an error a subscription hands over, such as `PLUGIN_UNAVAILABLE`.
 *
 * @param raw The error as the phone sent it.
 * @return The code in ASCII and short enough for the watch, or `UNKNOWN` when it carries none.
 */
export function errorCode(raw: unknown): string {
  const code = raw && typeof raw === 'object' ? (raw as { code?: unknown }).code : undefined;

  return typeof code === 'string' && code.trim() ? wire.toAscii(code.trim(), ERROR_MAX) : 'UNKNOWN';
}

/**
 * The face's message keys turned around, so a number on its way to the watch can be logged by name.
 *
 * @param messageKeys The face's message keys, by name.
 * @return The names, by number.
 */
export function keyNames(messageKeys: Record<string, number | undefined>): Record<string, string> {
  const names: Record<string, string> = {};

  Object.keys(messageKeys).forEach((name) => {
    names[String(messageKeys[name])] = name;
  });

  return names;
}

/**
 * Writes a message going to the watch, one line per key.
 *
 * @param dict The message.
 * @param names The face's key names, by number.
 * @param describeValue The face's own way to write a value, if it has one.
 * @return The lines for the log, the first one counting the keys.
 */
export function describeSend(dict: AppMessageDict, names: Record<string, string>, describeValue?: WatchOptions['describeValue']): string[] {
  const keys = Object.keys(dict);
  const lines = [`to the watch, ${keys.length} keys`];

  keys.forEach((key) => {
    const name = names[key] || key;
    const value = dict[key];
    const own = describeValue ? describeValue(name, value) : undefined;

    if (own) {
      own.forEach((line) => lines.push(`  ${line}`));
    } else if (Array.isArray(value)) {
      lines.push(`  ${name}=${value.length} bytes`);
    } else {
      lines.push(`  ${name}=${JSON.stringify(value)}`);
    }
  });

  return lines;
}

/**
 * The report the watch shows in its header.
 *
 * @param messageKeys The face's message keys, by name.
 * @param plugin The plugin that answered, or empty for none yet.
 * @param error The plugin's error, or empty once an update has landed.
 * @param extras The face's own keys.
 * @return The message.
 */
export function reportDict(messageKeys: Record<string, number>, plugin: string, error: string, extras: AppMessageDict): AppMessageDict {
  return { [messageKeys.TEST_PLUGIN]: plugin, [messageKeys.TEST_ERROR]: error, ...extras };
}

/** The phone's time now, to the second, for the start of a log line. */
function clock(): string {
  return new Date().toTimeString().slice(0, 8);
}


/** Whether a message from the watch asks for a reading, such as WEATHER_REQUEST. */
function isAsk(payload: Record<string, unknown>, names: Record<string, string>): boolean {
  return Object.keys(payload).some((key) => {
    const name = names[key] || key;

    return /_REQUEST$/.test(name) && name !== 'SETTINGS_REQUEST';
  });
}

/**
 * The feature that logs a plugin and reports it to the watch.
 *
 * List it first in startPebbleApp, ahead of the framework's own feature for the kind. The framework
 * reaches for the bridge's calls each time it subscribes or sends, so the wraps this puts in place are
 * what it finds.
 *
 * @param options The face's name, its kind, and its own keys.
 * @return The feature.
 */
export function watchPlugin(options: WatchOptions): Feature {
  return (context) => {
    const say = createLog(options.name);
    const messageKeys = context.messageKeys;
    const names = keyNames(messageKeys);
    const kind = `${options.category}/${options.item}`;
    const sender = createDedupedSender(context.queueSend, `${options.name} report`);
    // how many times each kind has been subscribed to, so only the newest subscription's updates count
    const generations: Record<string, number> = {};
    // the uuids the list has been read again for, so a plugin the list never names costs one read
    const lookedFor = new Set<string>();
    let plugins: PluginSummary[] = [];
    let latest: SourceEnvelope | null = null;
    let plugin = '';
    let error = '';

    /** Reads the phone's plugin list, or null when it has no list call or the call throws. */
    function readList(): unknown {
      if (typeof Pebble.enumeratePlugins !== 'function') {
        return null;
      }

      try {
        return Pebble.enumeratePlugins();
      } catch (thrown) {
        say(`enumeratePlugins threw ${String(thrown)}`);
        return null;
      }
    }

    /**
     * Takes a list the phone read as the plugins it has. A read that failed or gave back something
     * other than a list keeps the list from before, since a plugin the phone could not list may well
     * still be there.
     */
    function useList(list: unknown): boolean {
      if (!Array.isArray(list)) {
        return false;
      }

      plugins = pluginsIn(list);
      return true;
    }

    /** Sends the report, which the sender drops when the watch already holds the same one. */
    function report(): void {
      let extras: AppMessageDict = {};

      try {
        extras = options.extras ? options.extras(latest, messageKeys, Date.now()) : {};
      } catch (thrown) {
        // a slip in the face's own keys still leaves the header right
        say(`the face's report keys threw ${String(thrown)}`);
      }

      sender.push(reportDict(messageKeys, plugin, error, extras));
    }

    /**
     * Checks the list for a plugin serving the face's kind. With none the framework never subscribes,
     * so no error would ever reach the watch, and the report says NO_PLUGIN itself. Once one is back,
     * a NO_PLUGIN it said before is cleared.
     */
    function checkServed(): void {
      const served = servesKind(plugins, options.category, options.item);

      if (!served && error !== NO_PLUGIN) {
        say(`nothing on the phone serves ${kind}`);
        error = NO_PLUGIN;
      } else if (served && error === NO_PLUGIN) {
        say(`a plugin serves ${kind} again`);
        error = '';
      }
    }

    /** Logs one update, then reports it when it comes from the newest subscription to the face's kind. */
    function updated(request: SubscribeRequest, raw: unknown, current: boolean): void {
      const envelope = asEnvelope(raw);
      const uuid = String(envelope.pluginUuid);

      // a plugin installed since the last look is not on the list yet
      if (!findPlugin(plugins, envelope.pluginUuid) && !lookedFor.has(uuid)) {
        lookedFor.add(uuid);
        useList(readList());
      }

      const stale = current ? '' : ', from a replaced subscription, so ignored';
      const heading = `${clock()} ${String(request.category)}/${String(request.item)} update from ${pluginLabel(plugins, envelope.pluginUuid)}${stale}`;

      describeEnvelope(raw, heading, options.summary).forEach(say);

      if (current && request.category === options.category && request.item === options.item) {
        latest = envelope;
        plugin = pluginName(plugins, envelope.pluginUuid);
        error = '';
        report();
      }
    }

    /** Logs one error, then reports it when it comes from the newest subscription to the face's kind. */
    function failed(request: SubscribeRequest, raw: unknown, current: boolean): void {
      const message = raw && typeof raw === 'object' ? (raw as { message?: unknown }).message : undefined;
      const code = errorCode(raw);
      const stale = current ? '' : ', from a replaced subscription, so ignored';

      say(`${clock()} ${String(request.category)}/${String(request.item)} error ${code}: ${String(message)}${stale}`);

      if (current && request.category === options.category && request.item === options.item) {
        error = code;
        report();
      }
    }

    /** Puts the logging subscribe in place of the bridge's own. */
    function wrapSubscribe(): void {
      const host = Pebble;

      if (typeof host.subscribeToSource !== 'function') {
        say('this phone has no subscribeToSource, so no plugin will answer');
        return;
      }

      const subscribe = host.subscribeToSource.bind(host);

      const wrapped = (raw: unknown): unknown => {
        const request = (raw && typeof raw === 'object' ? raw : {}) as SubscribeRequest;
        const subscribed = `${String(request.category)}/${String(request.item)}`;
        const generation = (generations[subscribed] || 0) + 1;
        const current = () => generations[subscribed] === generation;

        generations[subscribed] = generation;
        say(`${clock()} subscribing to ${subscribed}, asking for ${(request.properties || []).join(', ') || 'everything'}`);

        return subscribe({
          ...request,
          onData: (envelope: unknown) => {
            updated(request, envelope, current());
            request.onData?.(envelope);
          },
          onError: (thrown: unknown) => {
            failed(request, thrown, current());
            request.onError?.(thrown);
          },
        });
      };

      // a Pebble app that hands over a frozen bridge keeps its own call, and the updates go unlogged
      try {
        host.subscribeToSource = wrapped;
      } catch {
        // the check below says so
      }

      if (host.subscribeToSource !== wrapped) {
        say('could not wrap Pebble.subscribeToSource, so plugin updates are not logged');
      }
    }

    /** Puts the logging send in place of the bridge's own. */
    function wrapSend(): void {
      const send = Pebble.sendAppMessage.bind(Pebble);

      const wrapped: PebbleBridge['sendAppMessage'] = (dict, onSuccess, onError) => {
        let noticed = false;

        describeSend(dict, names, options.describeValue).forEach((line, index) => say(index === 0 ? `${clock()} ${line}` : line));
        send(
          dict,
          () => {
            say('acked');
            onSuccess?.();
          },
          () => {
            say('nacked');
            onError?.();
          }
        );

        // the face reads the message after it has gone, so a slip in that never costs the watch the message
        try {
          noticed = options.noticeSend ? options.noticeSend(dict, messageKeys) : false;
        } catch (thrown) {
          say(`the face's reading of a message threw ${String(thrown)}`);
        }

        if (noticed) {
          report();
        }
      };

      // a Pebble app that hands over a frozen bridge keeps its own send, and the messages go unlogged
      try {
        Pebble.sendAppMessage = wrapped;
      } catch {
        // the check below says so
      }

      if (Pebble.sendAppMessage !== wrapped) {
        say('could not wrap Pebble.sendAppMessage, so messages to the watch are not logged');
      }
    }

    // the build loads the phone code under node to read its features, with a Pebble that cannot send
    if (typeof Pebble.sendAppMessage === 'function') {
      wrapSubscribe();
      wrapSend();
    }

    return {
      ready() {
        const list = readList();

        say(`${clock()} ready`);

        if (list === null) {
          say('this phone has no plugin list');
          return;
        }

        describePlugins(list).forEach(say);

        if (useList(list)) {
          checkServed();
          report();
        }
      },
      message(payload) {
        say(`${clock()} from the watch: ${Object.keys(payload).map((key) => names[key] || key).join(', ')}`);

        // the watch asks on its own poll, so a plugin that came or went since launch shows within one.
        // the ask also sends the report again, since a watch that asks may have lost the last one
        if (isAsk(payload, names)) {
          useList(readList());
          checkServed();
          sender.forget();
          report();
        }
      },
      configOpened() {
        say('settings page opening');
      },
    };
  };
}
