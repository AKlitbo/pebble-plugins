# Pebble Plugins

Pebble app plugins built on the [Pebble App Framework](https://github.com/AKlitbo/pebble-app-framework).

A plugin runs in the Pebble app on your phone and serves its data to every watchface that reads that kind of data, whoever made it. Each one serves a standard source in the shapes the Pebble app's own plugins use, so a watchface written for those reads these with no change.

## Plugins

| Plugin | What It Serves | Source | Needs |
| :-- | :-- | :-- | :-- |
| [Calendar + iCal](plugins/calendar-ical/) | The phone's calendars and up to two iCal links, merged into one agenda. | `calendar/event` | Nothing for the phone's calendars, and an iCal link for each feed. |
| [Stocks + Crypto](plugins/stocks-crypto/) | Stock and crypto prices from Yahoo, Finnhub, Twelve Data, or Alpha Vantage, in the order you set. | `finance/stock` and `finance/crypto` | Nothing for Yahoo, and your own key for the others. |
| [Weather Enhanced](plugins/weather-enhanced/) | The weather for the places in the Pebble app's weather list, from Open-Meteo, OpenWeatherMap, or WeatherAPI.com, kept inside each provider's plan. | `weather/location` | Nothing for Open-Meteo, and your own key for the others. |

Each plugin's own page covers its settings, its permissions, what it serves, and how to build it.

The [test watchfaces](watchfaces/) each read one kind of data from a plugin and log everything that arrives, for testing a plugin from a watch.

## Getting Started

1. **Turn Plugins On.** Plugins are still a Core Devices preview in the Pebble app. In the Pebble app, go to Settings, Plugins, and turn on Plugins / permissions preview.
2. **Install a Plugin** from the [Pebble appstore](https://apps.repebble.com/plugins). Each release here also attaches the plugin's `.pbw`.
3. **Pick It as the Source.** When more than one installed plugin serves the same thing, pick ours under Preferred Sources in the Pebble app's plugin settings. With only one, the Pebble app uses it on its own.
4. **Set It Up** in its settings in the Pebble app.
5. **Pick a Watchface** that reads that kind of data.

## Privacy

Everything a plugin keeps stays on your phone. Private links and API keys go to the phone's encrypted storage, which only that plugin can read. A plugin asks for each permission it needs, such as Internet for one provider's site, and requires only the ones it cannot work without, so you allow only what you use.

## Licence

AGPL-3.0-or-later, see [LICENSE](LICENSE). The third-party work a plugin bundles keeps its own licence, listed in [NOTICES.md](NOTICES.md).

## AI Training Notice

Please do not use this repository to train AI models. That is a request, not a term of the licence.
