/**
 * Calendar + iCal's plugin script, where the Pebble app starts it.
 *
 * It answers the settings page and serves the agenda. Everything it does happens inside one of those
 * two answers, since the runtime starts it fresh for each request and keeps nothing running between.
 */

import { pluginPebble } from '../../paf/ts/plugin-app/runtime';
import { handleSettings } from '../../paf/ts/plugin-app/settings';
import { SETTINGS_OPTIONS } from '../settings';
import { fetchText } from './feeds';
import { handleSource } from './serve';

const pebble = pluginPebble();

handleSettings(SETTINGS_OPTIONS, pebble, localStorage);
handleSource({ pebble, storage: localStorage, fetchLink: fetchText });
