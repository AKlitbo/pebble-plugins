# Calendar + iCal

A Pebble app plugin that serves the phone's calendars and up to two iCal links as one agenda, through the standard `calendar/event` source. Every watchface that reads calendar plugins reads it the way it reads the Pebble app's built-in Calendar plugin, with no change to the face. It needs no API key or account, and the calendar data stays on the phone.

## Settings

| Setting | What it does |
| :-- | :-- |
| Show Phone Calendars | Merges in the phone's calendars, on by default. Which calendars show is picked in the built-in Calendar plugin's settings in the Pebble app. |
| Feed 1 and Feed 2 | Each has a switch, a name, and an iCal link. The name goes out as the calendar each of the feed's events came from. A `webcal://` link is fetched as `https://`. |
| Refresh Interval | How old a feed's copy can get before it is fetched again, from 5 minutes to 1 hour, 30 minutes by default. |

The iCal links go to `Pebble.secureStorage`, which the phone encrypts and only the plugin can read, since a private link works like a password. The other settings go to `localStorage`.

## Permissions

The plugin asks for two. Internet fetches the iCal links, and Calendar reads the phone's calendars through the built-in. Neither is required, so refusing one leaves the other half serving.

## How It Works

The plugin has no timers. The Pebble app runs it about every five minutes while a face is subscribed, and again when the phone's calendars change. Each run reads the phone and both feeds side by side, merges them, and answers.

* **The Phone's Calendars** are read from the built-in Calendar plugin by its uuid, which reaches it even while Calendar + iCal is the preferred source. A read the Pebble app refuses, such as one without the Calendar permission, leaves the feeds serving on their own.
* **Each Feed** keeps its last good copy in `localStorage`, with a fingerprint of its link rather than the link. A run fetches the feed again once the copy reaches the Refresh Interval, or once the phone's midnight has passed since the fetch. A fetch that fails, or brings back something that is not iCal, keeps the copy and is tried again on the next run. Turning a feed off, or changing or clearing its link, drops the copy.
* **The Agenda** is today and the next six days, soonest first, at most 20 events. An event on the phone and in a feed shows once, as the phone's copy, when the two have the same title, the same start, and the same all-day flag. An event both feeds carry shows once when it has the same UID and start in each. Each event goes out under an id made from its start and title, so a face sees the same event from run to run.

Each event carries its title, its place when it has one, its start and end, whether it lasts all day, and the calendar it came from, in the shapes the built-in sends. An all-day event goes out from UTC midnight to UTC midnight, as the built-in sends one on Android.

## Known Limits

* Phone events stop at 10, and at 7 days ahead, since that is all the built-in serves.
* A cancelled event on an iPhone, and a declined event on either phone, still show from the phone's calendars, since the built-in sends no status. From a feed they are left out.
* West of UTC, today's all-day events from the phone drop out of the agenda in the evening, since the built-in ends them at UTC midnight.
* On a phone at UTC+13 or further east, such as New Zealand in summer, an all-day event reads a day late. The built-in's own all-day events do the same there, and matching the built-in keeps every face reading the two the same way.
* An event both feeds carry, where one feed has moved it, shows twice.
* Every face reading Calendar + iCal gets the same agenda.
* The runtime has no timers, so a feed's host that never answers is only cut off where the runtime offers `AbortSignal.timeout`, after 8 seconds.

## Building It

The unit pins [Pebble App Framework](https://github.com/AKlitbo/pebble-app-framework) 6.0.0 in its `paf.config.json`, and needs `paf 2.2.0` or later.

```sh
paf sync
paf build calendar-ical  # the .pbw, from WSL with Pebble SDK 4.44 and pebble-tool 5.1.2 or later
paf test
paf lint
paf typecheck
paf check
```

The pbw lands in `plugins/calendar-ical/targets/calendar-ical/build/`. The plugin's script starts in `src/plugin/index.ts` and its settings page in `src/config/index.ts`. The framework bundles both, with ical.js inside `plugin.js` under its MPL 2.0 licence, as [NOTICES.md](../../NOTICES.md) lists.
