# Stock Test Demo

A test watchface that shows what a Pebble app stock plugin serves, and logs every update in full.

It reads `finance/stock` from whichever plugin the Pebble app prefers for stocks and shows the first four tickers. It has no settings and needs no API key, since the plugin keeps its own. It's a tool for checking a plugin, not a watchface to wear, and is never released.

## What It Shows

- Each ticker's price and the day's change.
- The plugin's status for a ticker it has no price for, such as `RATE LIMIT` or `NO ACCESS`, beside the ticker it belongs to.

## Installation

1. **Turn Plugins On.** In the Pebble app, go to Settings, Plugins, and turn on Plugins / permissions preview.
2. **Build and Install It** as [Building](#building) covers.
3. **Pick the Plugin to Test.** When more than one plugin serves stocks, pick the one to test under Preferred Sources in the Pebble app's plugin settings.
4. **Open Stock Test Demo** on the watch.

## How It Works

* **The Tickers.** The plugin's watchlist decides the tickers and their order. The watch shows the first four the plugin serves, the same four any face built on the framework shows.
* **A Failed Ticker.** The framework's strip puts a status where the ticker goes, so the face sends each slot's ticker beside it and the row still names the ticker that failed.
* **The Logs.** The first ticker is logged with every property, and each other ticker with its symbol and price. [Reading the Logs](../README.md#reading-the-logs) covers the rest.

## Known Limitations

* The face matches tickers to slots by the framework's own rule, kept as a copy, since a face can't import that part of the framework. If the framework changes the rule, the copy has to change with it.
* The emulator has no plugin host, so there the face shows `waiting` or `NO_PLUGIN`.

## Building

The unit pins [Pebble App Framework](https://github.com/AKlitbo/pebble-app-framework) 6.2.1 in its `paf.config.json`, and needs `paf 2.2.0` or later. It builds for emery and gabbro.

```sh
paf sync
paf build stock-test-demo  # the .pbw, from WSL with Pebble SDK 4.44 and pebble-tool 5.1.2 or later
paf test
paf lint
paf typecheck
paf check
pebble install --phone <ip> watchfaces/stock-test-demo/targets/stock-test-demo/build/stock-test-demo.pbw
```

The phone side starts in `src/pkjs/index.ts` and the watch side in `src/c/main.c`. The files it shares with the other test faces are listed under [Shared Code](../README.md#shared-code).
