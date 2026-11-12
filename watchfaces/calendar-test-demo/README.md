# Calendar Test Demo

A test watchface that shows what a Pebble app calendar plugin serves, and logs every update in full.

It reads `calendar/event` from whichever plugin the Pebble app prefers for the calendar and shows the next six events. It has no settings. It's a tool for checking a plugin, not a watchface to wear, and is never released.

## What It Shows

- The next six events, grouped under Today, Tomorrow, or the day's date.
- Each event's start time, or All day, and its title.
- The calendar each event came from, in grey under the title.

## Installation

1. **Turn Plugins On.** In the Pebble app, go to Settings, Plugins, and turn on Plugins / permissions preview.
2. **Build and Install It** as [Building](#building) covers.
3. **Pick the Plugin to Test.** When more than one plugin serves the calendar, pick the one to test under Preferred Sources in the Pebble app's plugin settings.
4. **Open Calendar Test Demo** on the watch.

## How It Works

* **The Agenda.** The framework packs the events the watch shows, soonest first, so the face shows the same six any face built on the framework shows.
* **The Calendar Names.** The framework's agenda carries no calendar names, so the face finds each event back in the plugin's update by its title and start, and sends the names beside the agenda. An all-day event is matched within 14 hours, since the framework moves it to local midnight.
* **The Logs.** The first event is logged with every property, and each other event with its title and start. [Reading the Logs](../README.md#reading-the-logs) covers the rest.

## Known Limitations

* The watch shows a week ahead at most, whatever the plugin serves, since the framework's agenda stops there.
* Two events with the same title and start can swap calendar names.
* The emulator has no plugin host, so there the face shows `waiting` or `NO_PLUGIN`.

## Building

The unit pins [Pebble App Framework](https://github.com/AKlitbo/pebble-app-framework) 6.2.1 in its `paf.config.json`, and needs `paf 2.2.0` or later. It builds for emery and gabbro.

```sh
paf sync
paf build calendar-test-demo  # the .pbw, from WSL with Pebble SDK 4.44 and pebble-tool 5.1.2 or later
paf test
paf lint
paf typecheck
paf check
pebble install --phone <ip> watchfaces/calendar-test-demo/targets/calendar-test-demo/build/calendar-test-demo.pbw
```

The phone side starts in `src/pkjs/index.ts` and the watch side in `src/c/main.c`. The files it shares with the other test faces are listed under [Shared Code](../README.md#shared-code).
