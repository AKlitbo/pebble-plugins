/**
 * PebbleKit JS entry point for Stock Test Demo.
 *
 * Starts the app with stocks alone, read from the wearer's preferred stock plugin. It has no settings
 * of its own and no provider to fetch from, so the page holds only the stocks' notes and the supported
 * plugins panel.
 */
import app from '../../paf/ts/pkjs/app';
import stocks from '../../paf/ts/stock/feature';
import { watchPlugin } from './plugin-watch';
import { describeStrip, stockExtras } from './stock-keys';

app.startPebbleApp({
  clayConfig: [],
  features: [watchPlugin({ name: 'stock-test-demo', category: 'finance', item: 'stock', summary: ['ticker', 'price'], extras: stockExtras, describeValue: describeStrip }), stocks],
});
