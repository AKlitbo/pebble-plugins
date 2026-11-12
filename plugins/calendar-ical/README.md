# Calendar + iCal

A Pebble app plugin that puts the phone's calendars and up to two iCal links into one agenda on your watch.

Every watchface that reads calendar plugins reads it the way it reads the Pebble app's built-in Calendar plugin, with no change to the face. It serves the standard `calendar/event` source, so any face that shows your calendar today shows your iCal feeds too. It needs no API key or account, and your calendar data stays on your phone.

## Features

- The calendars the Pebble app's built-in Calendar plugin already reads.
- Up to two more calendars from an iCal link, such as a Google Calendar, a team schedule, or a sports fixture list.
- One agenda, soonest first, with each event shown once.
- A Refresh Interval you set, for how old a feed's copy can get.
- Your private iCal links kept in the phone's encrypted storage.

## Installation

1. **Turn Plugins On.** In the Pebble app, go to Settings, Plugins, and turn on Plugins / permissions preview.
2. **Install Calendar + iCal** from the Pebble app store.
3. **Make It the Calendar Source.** Under Preferred Sources in the Pebble app's plugin settings, pick Calendar + iCal for Calendar. With no other calendar plugin installed, the Pebble app uses it on its own.
4. **Pick a Watchface** that shows calendar events.

## Configuration

Open Calendar + iCal's settings in the Pebble app.

| Setting | What It Does |
| :-- | :-- |
| Show Phone Calendars | Merges in the phone's calendars, on by default. Which calendars show is picked in the built-in Calendar plugin's settings in the Pebble app, not here. |
| Feed 1 and Feed 2 | Each has a switch, a name, and an iCal link. The name shows as the calendar each of the feed's events came from. A `webcal://` link works, and is fetched as `https://`. |
| Refresh Interval | The most a feed's copy can age before the next run fetches it again, from 5 minutes to 1 hour, 30 minutes by default. It is a ceiling rather than a schedule, since the Pebble app decides when the plugin runs. |

> [!WARNING]
> A private iCal link lets anyone who has it read that calendar. Treat it like a password, and don't share or post it. Calendar + iCal keeps it in the phone's encrypted storage, which only the plugin can read.

### Google Calendar

1. Open [Google Calendar](https://calendar.google.com) on a computer.
2. Open Settings, then pick the calendar under Settings for My Calendars.
3. Under Integrate Calendar, copy **Secret address in iCal format**.
4. Paste it into Feed 1 or Feed 2, give the feed a name, and turn it on.

Each link covers one calendar, so a second Google calendar goes in the other feed. Outlook and iCloud also give an iCal link when you publish or share a calendar.

## Permissions

The plugin asks for two. Internet fetches the iCal links, and Calendar reads the phone's calendars through the built-in plugin. Neither is required, so refusing one leaves the other half serving.

## Data Source

Calendar + iCal serves `calendar/event`, one instance per event, in the shapes the built-in Calendar plugin sends.

| Property | What It Holds |
| :-- | :-- |
| `name` | The event's title. |
| `location` | Where it is, when it has a place. |
| `starts_at` | When it starts, with its time on the phone's clock as a label. |
| `ends_at` | When it ends, with a label as well. |
| `all_day` | Whether it lasts all day. |
| `calendar` | The calendar or feed it came from. |

Each event goes out under an id made from its start and title, so a face sees the same event from one run to the next. An all-day event goes out from UTC midnight to UTC midnight, as the built-in sends one on Android.

## How It Works

The plugin has no timers. The Pebble app runs it about every five minutes while a face is subscribed, and again when the phone's calendars change. Each run reads the phone and both feeds side by side, merges them, and answers.

* **The Phone's Calendars** are read from the built-in Calendar plugin by its uuid, which reaches it even while Calendar + iCal is the preferred source. A read the Pebble app refuses, such as one without the Calendar permission, leaves the feeds serving on their own.
* **Each Feed** keeps its last good copy in `localStorage`, with a fingerprint of its link rather than the link. A run fetches the feed again once the copy reaches the Refresh Interval, or once the phone's midnight has passed since the fetch. A fetch that fails, or brings back something that is not iCal, keeps the copy and is tried again on the next run. Turning a feed off, or changing or clearing its link, drops the copy.
* **The Agenda** is today and the next six days, soonest first, at most 20 events. An event on the phone and in a feed shows once, as the phone's copy, when the two have the same title, the same start, and the same all-day flag. An event both feeds carry shows once when it has the same UID and start in each.

The iCal links go to `Pebble.secureStorage`, which the phone encrypts and only the plugin can read. The other settings go to `localStorage`.

## Known Limitations

**Event Availability**

* Phone events stop at 10, and at 7 days ahead, since that is all the built-in plugin serves.
* The agenda holds at most 20 events across the phone and both feeds.
* Every face reading Calendar + iCal gets the same agenda.

**Event Status**

* A cancelled event on an iPhone, and a declined event on either phone, still show from the phone's calendars, since the built-in sends no status. From a feed they are left out.

**All-Day Events**

* West of UTC, today's all-day events from the phone drop out of the agenda in the evening, since the built-in ends them at UTC midnight.
* On a phone at UTC+13 or further east, such as New Zealand in summer, an all-day event reads a day late. The built-in's own all-day events do the same there, and matching the built-in keeps every face reading the two the same way.

**Duplicates**

* An event both feeds carry, where one feed has moved it, shows twice.

**Refreshing**

* The runtime has no timers, so a feed's host that never answers is only cut off where the runtime offers `AbortSignal.timeout`, after 8 seconds.

## Building

The unit pins [Pebble App Framework](https://github.com/AKlitbo/pebble-app-framework) 6.1.0 in its `paf.config.json`, and needs `paf 2.2.0` or later.

```sh
paf sync
paf build calendar-ical  # the .pbw, from WSL with Pebble SDK 4.44 and pebble-tool 5.1.2 or later
paf test
paf lint
paf typecheck
paf check
```

The pbw lands in `plugins/calendar-ical/targets/calendar-ical/build/`. The plugin's script starts in `src/plugin/index.ts` and its settings page in `src/config/index.ts`. The framework bundles both, with ical.js inside `plugin.js` under its MPL 2.0 licence, as [NOTICES.md](../../NOTICES.md) lists.
