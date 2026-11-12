/**
 * Weather Enhanced's plugin script, where the Pebble app starts it.
 *
 * It answers the settings page and serves the weather. Everything it does happens inside one of those
 * two answers, since the runtime starts it fresh for each request and keeps nothing running between.
 */

import { pluginPebble } from '../../paf/ts/plugin-app/runtime';
import { handleSettings } from '../../paf/ts/plugin-app/settings';
import { SETTINGS_OPTIONS } from '../settings';

const pebble = pluginPebble();

// TODO: put a page bridge in front of this that answers the page's ask for preferences/units (P6), and lifts a provider's stop on any save (P3)
handleSettings(SETTINGS_OPTIONS, pebble, localStorage);

// the Pebble app fills its own Weather app from its backend on this error, so the watch keeps its weather
pebble.registerSourceHandler((_request, respond) => {
  // TODO: read the Pebble app's places (P2), keep a copy per place under the ledger (P3), and serve every place with the Open-Meteo failover (P4)
  respond.error('PLUGIN_UNAVAILABLE', 'Weather Enhanced does not serve the weather yet');
});
