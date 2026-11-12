/**
 * PebbleKit JS entry point for Weather Test Demo.
 *
 * Starts the app with the weather alone, read from the wearer's preferred weather plugin, with the
 * coordinates on. The pressure, the dew point, and the UV come from the face's message keys, which
 * is how the framework knows to ask the plugin for them and their hourly series. It has no settings
 * of its own, so the page holds only the weather's notes and the supported plugins panel.
 */
import app from '../../paf/ts/pkjs/app';
import weather from '../../paf/ts/weather/feature';
import { watchPlugin } from './plugin-watch';
import { formatCoords, weatherExtras } from './weather-keys';

app.startPebbleApp({
  clayConfig: [],
  features: [watchPlugin({ name: 'weather-test-demo', category: 'weather', item: 'location', summary: ['name'], extras: weatherExtras }), weather.withCoords(formatCoords)],
});
