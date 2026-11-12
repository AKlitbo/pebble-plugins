/**
 * Weather Enhanced's plugin script, where the Pebble app starts it.
 *
 * It answers the settings page and serves the weather. Everything it does happens inside one of those
 * two answers, since the runtime starts it fresh for each request and keeps nothing running between.
 */

import { pluginRequest } from '../../paf/ts/plugin-app/request';
import { pluginPebble } from '../../paf/ts/plugin-app/runtime';
import { SETTINGS_OPTIONS } from '../settings';
import { handlePage } from './page-bridge';
import { handleSource } from './serve';

const pebble = pluginPebble();

handlePage(SETTINGS_OPTIONS, pebble, localStorage);
handleSource({ pebble, storage: localStorage, request: pluginRequest });
