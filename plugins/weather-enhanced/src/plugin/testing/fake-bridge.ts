/**
 * The plugin's real answers to its settings page, for the specs, with the Pebble app's units and
 * weather places read answered the way a spec says.
 */

import { SETTINGS_KEY } from '../../../paf/ts/plugin-app/settings';
import type { PluginPebble, SourceRequest } from '../../../paf/ts/plugin-app/runtime';
import type { SourceEnvelope, SourceInstance, SourceProperty } from '../../../paf/ts/plugin-sources/types';
import { SETTINGS_OPTIONS } from '../../settings';
import { handlePage } from '../page-bridge';

/** The Pebble app's Preferences plugin answering its units as °F, mph, and inHg. */
export const IMPERIAL_UNITS: SourceEnvelope = {
  instances: [{ instanceId: 'units', properties: { temperature: { shortText: { text: '°F' } }, wind_speed: { shortText: { text: 'mph' } }, pressure: { shortText: { text: 'inHg' } } } }],
};

/** What a spec gives the plugin beside the units read. */
export interface BridgeOptions {
  /** Answers the read of `preferences/weather_location`, or rejects for a refused one. Left out, it rejects. */
  readPlaces?: () => Promise<SourceEnvelope>;
  /** The settings already saved. */
  settings?: Record<string, unknown>;
}

/**
 * A place as the Pebble app's Preferences plugin lists it. Coordinates left out make a place with no
 * fix, as the current location can be.
 */
export function appPlace(key: string, name: string, coords?: [number, number], current = false): SourceInstance {
  const properties: Record<string, SourceProperty> = { name: { shortText: { text: name } }, current: { boolean: { value: current } } };

  if (coords) {
    properties.latitude = { numericValue: { value: coords[0] } };
    properties.longitude = { numericValue: { value: coords[1] } };
  }

  return { instanceId: key, properties };
}

/**
 * The plugin's answer to the page, with the Pebble app answering the units read the way given.
 *
 * @param readUnits Answers the read of `preferences/units`, or rejects for a refused one.
 * @param more The places read and the saved settings.
 * @return Sends the page's message and hands back the plugin's reply.
 */
export function bridgeWith(readUnits: () => Promise<SourceEnvelope>, more: BridgeOptions = {}): (message: unknown) => Promise<unknown> {
  const items = new Map<string, string>([[SETTINGS_KEY, JSON.stringify(more.settings || {})]]);
  const readPlaces = more.readPlaces || (() => Promise.reject(new Error('not in the spec')));
  let handler: ((message: unknown, respond: (reply: unknown) => void) => void | Promise<void>) | null = null;
  const pebble = {
    registerConfigHandler: (registered: typeof handler) => void (handler = registered),
    readSource: (request: SourceRequest) => (request.item === 'units' ? readUnits() : request.item === 'weather_location' ? readPlaces() : Promise.reject(new Error('not in the spec'))),
    refreshSources: () => undefined,
    secureStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
  } as unknown as PluginPebble;

  handlePage(SETTINGS_OPTIONS, pebble, { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) });

  return async (message) => {
    let reply: unknown = null;

    await handler!(message, (answer) => void (reply = answer));

    return reply;
  };
}
