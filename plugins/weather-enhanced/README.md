# Weather Enhanced

A Pebble app plugin that puts the weather for your places on your watch, from Open-Meteo with no key, or your own OpenWeatherMap or WeatherAPI.com key.

Every watchface that reads weather plugins reads Weather Enhanced with no change. It serves the standard `weather/location` source with the properties the Pebble app's built-in Weather plugin sends, and adds pressure, dew point, the full weather code, and a longer list of hourly and daily series for faces that show them. Pick it as your preferred weather source and the Pebble app builds the watch's own Weather app and the timeline's weather pins from it too. Open-Meteo needs no key, and a call ledger keeps every provider inside its plan.

## Features

- Open-Meteo with no key, or your own OpenWeatherMap or WeatherAPI.com key.
- The places in the Pebble app's weather list, the first one or all of them up to five.
- Pressure, dew point, and the full weather code now, beside the standard set.
- Every provider held inside its plan's limits, with a Paid Plan switch to lift them for a keyed one.
- The last good reading kept for a while, then Open-Meteo, when your provider cannot answer.
- The Pebble app's units by default, with an override for each.
- Each place's coordinates too, so it also works with watchfaces that show where you are.

## Installation

1. **Turn Plugins On.** In the Pebble app, go to Settings, Plugins, and turn on Plugins / permissions preview.
2. **Install Weather Enhanced** from the Pebble app store.
3. **Make It the Weather Source.** Under Preferred Sources in the Pebble app's plugin settings, pick Weather Enhanced for Weather. With no other weather plugin installed, the Pebble app uses it on its own. A face that names the built-in Weather plugin itself keeps reading the built-in.
4. **Add Your Places** to the Pebble app's weather list. Weather Enhanced fetches the places on that list and nowhere else.
5. **Pick a Watchface** that shows weather.

TODO: whether Settings, Weather in the Pebble app and the Preferred Sources choice for `weather/location` are one setting or two. Step 3 changes to match once the first build shows it.

## Configuration

Open Weather Enhanced's settings in the Pebble app.

| Setting | What It Does |
| :-- | :-- |
| Data Source | Where the weather comes from: Open-Meteo, OpenWeatherMap, or WeatherAPI.com. Open-Meteo by default. |
| API Key | One per keyed provider, shown while that provider is picked. Switching provider and back keeps each key. |
| Paid Plan | One per keyed provider, off by default. Turn it on if your key is on a paid plan, and the plugin stops holding it to the free plan's limits. |
| Places to Fetch | The first place in the Pebble app's weather list, or all of them up to five, which is the default. |
| Refresh Interval | How old a place's reading can get before the next run fetches it again: 15, 30, 60, or 120 minutes, 30 by default. It is a ceiling rather than a schedule, since the Pebble app decides when the plugin runs. While your provider cannot answer, its last reading can stand in for up to three intervals, as How It Works covers. |
| Units | Shows the units the Pebble app is set to, which the plugin follows by default. Each unit can be overridden here. |

**The Watch's Weather App.** The page says that picking Weather Enhanced as the preferred weather source also makes it the source for the watch's own Weather app and the timeline's weather pins.

**Credits.** The footer under Save credits Open-Meteo always, and OpenWeatherMap or WeatherAPI.com while that one is picked.

### Getting an API Key

Open-Meteo needs none. Each of the others gives a free key when you sign up on its site.

- **OpenWeatherMap:** sign up at [openweathermap.org](https://openweathermap.org). The key is under API Keys in your account. A new key can take a couple of hours to start working.
- **WeatherAPI.com:** sign up at [weatherapi.com](https://www.weatherapi.com). The key is on your dashboard.

> [!WARNING]
> An API key is tied to your account. Don't share it or post it anywhere. Weather Enhanced keeps it in the phone's encrypted storage, which only the plugin can read.

## Permissions

The plugin asks for Internet once for each provider's site: `open-meteo.com`, `api.openweathermap.org`, and `api.weatherapi.com`. Open-Meteo's is required, since every provider's forecast series come from it and it is the fallback when your provider fails. The other two are optional, so you allow only the one you use. It also needs Location to read the places in the Pebble app's weather list, and a watchface reading Weather Enhanced asks for Location too, as it does for the Pebble app's own Weather plugin.

## Data Source

Weather Enhanced serves `weather/location`, one instance per place, under the place's key from the Pebble app's weather list.

Temperatures, wind, and pressure go out in your units, and every numeric field carries its unit, so a face that converts reads them either way. An hourly series starts at the place's own midnight, one hour apart for 48 hours. A daily series starts with the place's today, one day apart for 8 days.

### The Standard Set

These are the properties the built-in Weather plugin sends, in the same shapes.

| Property | What It Holds |
| :-- | :-- |
| `name` | The place's name from the Pebble app's weather list. |
| `temperature` | The temperature now. |
| `feels_like` | What the temperature feels like now. |
| `high`, `low` | Today's high and low. |
| `condition` | A short label for the weather now. |
| `condition_code` | The weather now as one of the standard's nine codes. |
| `uv_index` | Today's highest UV index, as the built-in sends it, or the UV index now when the forecast has none for today. |
| `precipitation` | Today's chance of rain or snow, in percent. |
| `humidity` | The humidity now, in percent. |
| `wind_speed` | The wind speed now. |
| `wind_direction` | Where the wind is coming from, in degrees. |
| `utc_offset` | The place's own offset from UTC. |
| `sunrise`, `sunset` | Today's sunrise and sunset at the place. |
| `hourly_temperature` | The temperature each hour. |
| `hourly_condition`, `hourly_condition_code` | The weather each hour, as a label and as one of the nine codes. |
| `daily_high`, `daily_low` | Each day's high and low. |
| `daily_condition`, `daily_condition_code` | Each day's weather, as a label and as one of the nine codes. |
| `daily_precipitation` | Each day's chance of rain or snow, in percent. |
| `daily_sunrise`, `daily_sunset` | Each day's sunrise and sunset. |

### Extra Readings Now

These come from the provider you picked.

| Property | What It Holds |
| :-- | :-- |
| `pressure` | The air pressure now, at sea level. |
| `dew_point` | The dew point now. |
| `weather_code` | The weather now as a WMO weather code, which keeps fog, drizzle, showers, and thunder apart where the nine codes fold them together. |

### Extra Series

These come from Open-Meteo whichever provider you picked, so every provider serves the same series.

| Property | What It Holds |
| :-- | :-- |
| `hourly_pressure` | The air pressure each hour, at sea level. |
| `hourly_dew_point` | The dew point each hour. |
| `hourly_weather_code`, `daily_weather_code` | The WMO weather code each hour and each day. |
| `hourly_is_day` | Whether each hour is in daylight, for night icons. |
| `hourly_humidity` | The humidity each hour, in percent. |
| `hourly_feels_like` | What the temperature feels like each hour. |
| `hourly_wind_speed`, `hourly_wind_direction`, `hourly_wind_gust` | The wind each hour, with its direction and its gusts. |
| `hourly_cloud_cover` | The cloud cover each hour, in percent. |
| `hourly_visibility` | How far you can see each hour. |
| `hourly_solar_radiation` | The sunshine reaching the ground each hour. |
| `hourly_cape` | How much energy the air holds for storms each hour. |
| `hourly_uv_index`, `daily_uv_index` | The UV index each hour, and each day's highest. |
| `hourly_precipitation` | The chance of rain or snow each hour, in percent. |
| `hourly_precipitation_amount`, `daily_precipitation_amount` | How much rain and snow falls each hour and each day. |
| `hourly_rain`, `daily_rain` | How much rain falls each hour and each day. |
| `hourly_snowfall`, `daily_snowfall` | How much snow falls each hour and each day. |

### Where the Place Is

Neither the built-in Weather plugin nor the standard carries a place's coordinates, so a watchface that shows them gets them here. They go only to a face that asks for them by name, and only as a pair. A face reads them under the Location permission, like every other field, so it can use the wearer's place with no location code of its own.

| Property | What It Holds |
| :-- | :-- |
| `latitude`, `longitude` | The place's coordinates, from the Pebble app's weather list, to four decimal places. |

### Where It Came From

| Property | What It Holds |
| :-- | :-- |
| `source` | The provider the reading came from, which is Open-Meteo when the fallback answered. |
| `updated` | When the reading is from, with its time on the phone's clock. |

The plugin always sends every current reading but the coordinates, and sends only the series a face asks for, as the built-in does, so a face reading the standard set does not carry the extra series or the place's coordinates.

## How It Works

The plugin has no timers, and the Pebble app stops each run after 20 seconds. Each run starts cold, so everything below lives in `localStorage`.

TODO: how often the Pebble app runs the plugin with a face and its own weather fetch both subscribed. Count the runs over an hour in the logs during the first build, then say it here as the other plugins do.

* **The Places.** Each run reads the Pebble app's weather list, in your order, and takes the first place or up to five, as Places to Fetch says. The current location carries the coordinates of the Pebble app's last fix. When it has none, the plugin skips it for that run.
* **The Copy.** Each place keeps a copy of its last reading. A run answers from the copy until it reaches the Refresh Interval, then fetches that place again and keeps the result. A place whose fetch failed waits out the Refresh Interval too, so a provider that is down is asked once an interval rather than on every run.
* **The Fetch.** Every place is fetched side by side. Open-Meteo is asked for every place in one request. OpenWeatherMap's free call and WeatherAPI.com give the reading now, and the hourly and daily series come from Open-Meteo, so every provider gives the same forecast.
* **The Limits.** The framework's ledger counts every call against each provider's plan, Open-Meteo's included, and says how many more fit. Open-Meteo counts a request asking for many readings as several calls, so the ledger counts each call by that weight. A provider that answers `RATE LIMIT` anyway is left alone until its shortest limit opens again, a minute for Open-Meteo and OpenWeatherMap, and never longer than an hour. WeatherAPI.com is held until the 1st of the month only when it says the month's calls are spent, and for an hour after any other rate limit. A key on Paid Plan is left alone for a minute, and turning Paid Plan on or off lifts the hold. A provider that answers `INVALID KEY` is left alone until you save the settings, or for a day.
* **The Fallback.** When your provider cannot answer, the last reading it gave for a place is served while it is under three Refresh Intervals old. Past that the plugin serves the Open-Meteo reading fetched beside your provider's for the forecast, and `source` says so. An Open-Meteo reading kept from an earlier fallback is only served while it is fresh, so a newer one always wins. Only when there is none, such as while your provider is held, does it ask Open-Meteo on its own, and only while the run has time left. A run whose Open-Meteo half already failed does not ask it again.
* **When Nothing Works.** A place without today's and tomorrow's forecast is left out, and the Pebble app fills it from its own servers. If no place can be served, the plugin answers `PLUGIN_UNAVAILABLE` rather than sending half a reading, and the Pebble app fills every place.
* **Units.** The plugin reads your units from the Pebble app's settings, unless you override one on the settings page.

TODO: whether the watch's own Weather app follows the units the plugin sends, or assumes the Pebble app's setting. If it assumes, the Units row in Configuration gets a note saying an override only reaches watchfaces.

### The Watch's Weather App

When Weather Enhanced is your preferred weather source, the Pebble app reads it for the watch's own Weather app and the timeline's weather pins, and waits up to 45 seconds for the answer. It takes a place only when the plugin sends the temperature now, the weather code, the place's offset from UTC, and today's and tomorrow's high, low, weather, sunrise, and sunset. A place the plugin leaves out, such as the current location with no coordinates, comes from the Pebble app's own servers instead.

The API keys go to `Pebble.secureStorage`, which the phone encrypts and only the plugin can read. The other settings go to `localStorage`.

## What Each Free Key Allows

> [!NOTE]
> Last checked on 12 November 2026, from each provider's own pricing and terms pages. Providers change their free plans without notice, so check the provider's site if a figure here looks wrong.

| Provider | Free Limit | Terms |
| :-- | :-- | :-- |
| Open-Meteo | 600 a minute, 5,000 an hour, 10,000 a day, and 300,000 a month. A request asking for more than 10 readings, or more than two weeks, counts as several calls. | Free for non-commercial use. The data is under CC BY 4.0, so it has to be credited. |
| OpenWeatherMap | 60 a minute and 1,000,000 a month on the free Current Weather API. | Commercial use is allowed. The data has to be credited as "Weather data © OpenWeather". |
| WeatherAPI.com | 100,000 a month, with no limit a minute. The free forecast covers 3 days. Once the month is spent it stops answering until the 1st. | Commercial use is allowed. It asks for a link back, "Powered by WeatherAPI.com". |

**Open-Meteo's Weight.** With every extra in, one place asks for about 39 readings across now, hourly, and daily, so each place costs about 4 calls. Five places every 30 minutes is about 960 calls a day and 28,800 a month, inside every limit. Every 15 minutes doubles that and still fits. Open-Meteo does not say how it counts a request for several places, so the ledger counts each place.

**The Windows.** Where a provider does not say whether a limit follows the clock, the ledger rolls it, since a rolling window never lets more through than a clock window of the same length. Open-Meteo's four limits all roll. OpenWeatherMap's minute and month roll. WeatherAPI.com's month follows the clock and resets on the 1st, UTC.

**Sharing with a Watchface.** The counts are the plugin's own. A watchface fetching weather itself on the same phone keeps its own count, so a face and the plugin both on Open-Meteo each count their own calls against limits Open-Meteo applies to the phone as a whole. On a keyed provider, give each its own key, or turn the face's own weather fetching off.

## Credits

- Weather data by [Open-Meteo](https://open-meteo.com), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). TODO: confirm Open-Meteo's exact credit wording from its licence page.
- Weather data © [OpenWeather](https://openweathermap.org).
- Powered by [WeatherAPI.com](https://www.weatherapi.com).

## Known Limitations

**Places**

* Only the places in the Pebble app's weather list, and at most five.
* The current location is skipped for a run when the Pebble app has no fix for it.
* Every face reading Weather Enhanced gets the same places.

**Readings**

* The hourly and daily series and the extra series come from Open-Meteo whichever provider you pick. Under OpenWeatherMap the dew point now comes from Open-Meteo as well.
* There are no weather alerts, air quality, or marine readings.
* There is no weather icon or picture, so each face draws its own from the weather code.

**Refreshing**

* The Pebble app stops a run after 20 seconds. A place that has not answered by then is served from its copy, or left out.
* A copy three Refresh Intervals old or more is not served, so a long run of failures with Open-Meteo also down leaves the watch's Weather app to the Pebble app's own servers.
* WeatherAPI.com stops answering for the rest of the month once its free quota is spent. Weather Enhanced falls back to Open-Meteo until the 1st.

**The Phone's Clock**

* A phone clock set a day ahead and back again can let a day's calls go out twice, since the counts read the phone's clock.

## Building

The unit pins [Pebble App Framework](https://github.com/AKlitbo/pebble-app-framework) 6.2.0 in its `paf.config.json`, and needs `paf 2.2.0` or later.

TODO: the pin moves from 6.1.0 to 6.2.0 once the framework releases it.

```sh
paf sync
paf build weather-enhanced  # the .pbw, from WSL with Pebble SDK 4.44 and pebble-tool 5.1.2 or later
paf test
paf lint
paf typecheck
paf check
```

The pbw lands in `plugins/weather-enhanced/targets/weather-enhanced/build/`. The plugin's script starts in `src/plugin/index.ts` and its settings page in `src/config/index.ts`, and both read the settings in `src/settings.ts`. The places it reads live in `src/plugin/places.ts` and the run in `src/plugin/serve.ts`, with each place's copy in `copies.ts`, the stops in `gates.ts`, and the counting in `meter.ts` beside it. The free plans it holds each provider to are in `src/limits.ts`. They sit on top of the framework's weather source in `ts/plugin-app/weather.ts` and its shared ledger in `ts/quota/`.
