# Test Watchfaces

Watchfaces for testing Pebble app plugins from a watch.

Each one reads a single kind of data from whichever plugin the Pebble app prefers for it, shows what arrived, and logs every update in full. They're tools for checking a plugin, not watchfaces to wear, and are never released.

## Watchfaces

| Watchface | What It Shows | Source |
| :-- | :-- | :-- |
| [Stock Test Demo](stock-test-demo/) | The first four tickers, each with its price and change, or the plugin's status for a ticker it has no price for. | `finance/stock` |
| [Calendar Test Demo](calendar-test-demo/) | The next six events by day, each with its start, its title, and its calendar. | `calendar/event` |
| [Weather Test Demo](weather-test-demo/) | The first place's weather now and today, its pressure, dew point, UV, and WMO code, and its name and coordinates. | `weather/location` |

Each watchface's own page covers what it shows, how it works, and how to build it.

## Getting Started

1. **Turn Plugins On.** In the Pebble app, go to Settings, Plugins, and turn on Plugins / permissions preview.
2. **Install the Plugin to Test** and set it up in its settings in the Pebble app.
3. **Pick It as the Source** under Preferred Sources in the Pebble app's plugin settings, when more than one plugin serves the same kind.
4. **Build and Install the Watchface** for that kind, as its page covers.
5. **Capture the Logs** with `pebble logs --phone <ip>`, and open the watchface on the watch.

## The Screen

The header names the watchface, the plugin that answered, and how old the reading is, such as `now` or `4m`. On a round watch the plugin and the age move to a footer at the bottom.

* **Waiting.** Shown until the first update lands. Each launch starts empty, so everything on the screen came from the plugin since then.
* **A Plugin Error.** The plugin's error, such as `PLUGIN_UNAVAILABLE`, shows in place of the data.
* **NO_PLUGIN.** Nothing on the phone serves that kind. The phone checks again each time the watch asks for a reading, so installing a plugin clears it within one poll.
* **A Missing Value** reads as a dash.

## Reading the Logs

`pebble logs --phone <ip>` captures both sides at once. Every phone line starts with the watchface's name in brackets, such as `[weather-test-demo]`.

* **At Launch.** Every plugin the phone has, with its uuid and each kind it serves.
* **Each Update.** Which plugin answered, its `validUntilMs`, and then the first instance with every property, each shape it came in, and its values. Every other instance gets one line with the few properties that tell it apart, since the Pebble app's log drops and reorders lines when too many arrive at once. A series shows its start, its step, and its first four points.
* **Errors.** The code and the message of each error a plugin sends.
* **To the Watch.** Every message going out, key by key, with a packed stock strip or agenda unpacked, then `acked` or `nacked`.
* **On the Watch.** A short summary of what the watch holds after each message, such as `weather-test-demo from 'Weather Enhanced', error '', status '', age now`.

Every phone line is plain ASCII and at most 120 characters, and a longer one goes out in pieces marked with a `+`. A degree sign reads as `deg` and anything else outside ASCII as its `\u` code, since `pebble logs` crashes on a line cut through the middle of a character.

## Shared Code

A paf unit only builds what sits inside its own folder, so each watchface keeps its own copy of the shared files:

* `src/pkjs/log-lines.ts` and `src/pkjs/plugin-watch.ts`, with their specs.
* `src/c/screen.c` and `src/c/report.c`, with their headers.

The three copies are the same, so a fix to one goes into the other two.
