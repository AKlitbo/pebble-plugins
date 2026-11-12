# Weather Test Demo

A test watchface that shows what a Pebble app weather plugin serves, and logs every update in full.

It reads `weather/location` from whichever plugin the Pebble app prefers for the weather and shows the first place's reading. It has no settings and needs no API key. It's a tool for checking a plugin, not a watchface to wear, and is never released.

## What It Shows

- The temperature now, the sky, and how it feels.
- Today's high, low, and chance of rain.
- The pressure, the dew point, the UV, and the WMO weather code.
- The place's name and its coordinates.

## Installation

1. **Turn Plugins On.** In the Pebble app, go to Settings, Plugins, and turn on Plugins / permissions preview.
2. **Build and Install It** as [Building](#building) covers.
3. **Pick the Plugin to Test.** In the Pebble app, pick it as the Weather provider under Settings, Weather. Weather under Preferred Sources is the same choice.
4. **Open Weather Test Demo** on the watch.

## How It Works

* **What It Asks For.** The face asks the plugin by name for the pressure, the dew point, the UV, and the coordinates, and for the hourly series of the dew point, the UV, and the WMO code. A plugin that serves none of them still fills the rows the built-in serves.
* **The Rows the Framework Needs.** The framework reads the pressure, dew point, and UV only beside the feels like temperature and today's high, low, and chance of rain, so those rows show too.
* **The Logs.** The first place is logged with every property, and each other place with its name. [Reading the Logs](../README.md#reading-the-logs) covers the rest.

## Known Limitations

* Only the first place shows on the watch, though every place is logged.
* The emulator has no plugin host, so there the face shows `waiting` or `NO_PLUGIN`. The layout still shows, which is handy for checking a round screen.

## Building

The unit pins [Pebble App Framework](https://github.com/AKlitbo/pebble-app-framework) 6.2.1 in its `paf.config.json`, and needs `paf 2.2.0` or later. It builds for emery and gabbro.

```sh
paf sync
paf build weather-test-demo  # the .pbw, from WSL with Pebble SDK 4.44 and pebble-tool 5.1.2 or later
paf test
paf lint
paf typecheck
paf check
pebble install --phone <ip> watchfaces/weather-test-demo/targets/weather-test-demo/build/weather-test-demo.pbw
```

The phone side starts in `src/pkjs/index.ts` and the watch side in `src/c/main.c`. The files it shares with the other test faces are listed under [Shared Code](../README.md#shared-code).
