/**
 * Calendar Enhanced + iCal's plugin script, where the Pebble app starts it.
 *
 * It answers the settings page and serves the agenda. Everything it does happens inside one of those
 * two answers, since the runtime starts it fresh for each request and keeps nothing running between.
 */

import { pluginPebble } from '../../paf/ts/plugin-app/runtime';
import { fetchText } from '../../paf/ts/plugin-app/request';
import { handlePage } from './page-bridge';
import { handleSource } from './serve';

const pebble = pluginPebble();

handlePage(pebble, localStorage);
handleSource({ pebble, storage: localStorage, fetchLink: fetchText });
