# Calendar Enhanced + iCal

A Pebble app plugin that puts the phone's calendars and up to two iCal links into one agenda on your watch.

Every watchface that reads calendar plugins reads it the way it reads the Pebble app's built-in Calendar plugin, with no change to the face. It serves the standard `calendar/event` source, so any face that shows your calendar today shows your iCal feeds too. It needs no API key or account, and your calendar data stays on your phone.

## Features

- The calendars the Pebble app's built-in Calendar plugin already reads, each of which you can keep off your watchfaces.
- Up to two more calendars from an iCal link, such as a Google Calendar, a team schedule, or a sports fixture list, or from a country's public holidays in one pick.
- One agenda, soonest first, with each event shown once and its notes carried as the built-in carries them.
- A Look Ahead you set, from today only to a month.
- Your iCal events on the watch's timeline, with a reminder before each.
- Time labels that can follow your 12 or 24 hour clock and name the day, for watchfaces that show them.
- Filters to hide meetings already underway, to leave out all-day events, to leave out the iCal events you declined, marked tentative, or marked free, and to leave out events by words in their titles.
- An iCal Refresh Interval you set, for how old a feed's copy can get.
- Your private iCal links kept in the phone's encrypted storage.

## Installation

1. **Turn Plugins On.** In the Pebble app, go to Settings, Plugins, and turn on Plugins / permissions preview.
2. **Install Calendar Enhanced + iCal** from the Pebble app store.
3. **Make It the Calendar Source.** Under Preferred Sources in the Pebble app's plugin settings, pick Calendar Enhanced + iCal for Calendar. With no other calendar plugin installed, the Pebble app uses it on its own.
4. **Pick a Watchface** that shows calendar events.

## Configuration

Open Calendar Enhanced + iCal's settings in the Pebble app.

| Setting | What It Does |
| :-- | :-- |
| Show Phone Calendars | Merges in the phone's calendars, on by default. Under it, each of your phone's calendars has a switch, all on by default. A calendar switched off stays off your watchfaces. One switched off with no events this week still shows, marked as having none, so you can turn it back on, and it stays off until you do. The list shows the calendars with events in the next 7 days, since that's all the Pebble app shares. The Pebble app's own calendar switches still decide which calendars it reads and pins to the timeline, so a calendar switched off there never reaches this list. |
| iCal Feed 1 and iCal Feed 2 | Each has a switch, a Source, a name, and an iCal link. Source is iCal Link by default. Public Holidays swaps the link for a Country, from 38 countries, and the feed takes the country's holiday name, such as US Holidays, unless you've named it. Include Observances, off by default, adds days such as Valentine's Day that aren't days off. The name shows as the calendar each of the feed's events came from. A `webcal://` link works, and is fetched as `https://`. Under the link, the page shows when the feed was last fetched, how many events it gave, and its last error since then. |
| iCal Refresh Interval | The most a feed's copy can age before the next run fetches it again, from 5 minutes to 1 hour, 30 minutes by default. It is a ceiling rather than a schedule, since the Pebble app decides when the plugin runs. |
| Look Ahead | Sets how far ahead the calendar goes, from today only to a month, 1 week by default. Your iCal feeds follow it in full, though a watchface that only shows a week still shows a week. Events from your phone's calendars come through the Pebble app, which only shares the next seven days, so they stop at a week whatever you pick. If you'd like that longer, it's one for Eric at Pebble. |
| Hide Events in Progress | Takes a meeting off the agenda once it has been going a while, so a face shows what comes next. Never by default, or When They Start, 15 Minutes After, 30 Minutes After, or 60 Minutes After. All-day events, and anything that runs a day or more, stay until they end. |
| Show All-Day Events | Keeps all-day events on the agenda, on by default. Turn it off when all-day reminders and statuses crowd out your next meeting. |
| Hide Declined Events | Leaves out an iCal event you declined, off by default. It finds your answer among the guests by Your Email Addresses, a list separated by commas, which shows while this or Hide Tentative Events is on. |
| Hide Tentative Events | Leaves out an iCal event you answered Maybe to, found by Your Email Addresses, or one the organizer marked tentative, off by default. |
| Hide Free Events | Leaves out a timed iCal event that shows you as free, off by default. All-day events stay, since holiday calendars mark every holiday as free. |
| Hide Events Titled | Leaves out an event from any calendar whose title has one of the words you list, separated by commas, such as `Lunch, Focus Time, Canceled:`. Empty by default. A word matches from the start of a word in the title, whatever its case, so `Lunch` hides Team Lunch but not Brunch. |
| Pin iCal Events to the Timeline | Puts the events from your iCal feeds on your watch's timeline, off by default. Your phone's own events are pinned by the Pebble app already, so they, and any feed event your phone also holds, get no second pin, even from a phone calendar switched off here. With Show Phone Calendars off the phone isn't read, so a feed event it also holds gets a pin. A pin follows the agenda and its filters, apart from Hide Events in Progress, so a meeting keeps its pin while it runs. A feed event that moves, goes, or is filtered off loses its pin, and one that has simply ended keeps it. All-day events are pinned for their whole day with no reminder. At most 50 pins are kept, the soonest first. |
| Reminder | When a pinned event reminds you before it starts: None, When It Starts, or 5, 10, 15, 30, or 60 minutes before, 15 minutes by default. |
| Time Labels | How event times are written on watchfaces that show them as text. Same as the Pebble App, the default, writes `14:30` for any day. Short writes `2:30p` on a 12-hour clock and shows the day for an event that isn't today, such as `Thu` or `Nov 27`, in your watch's language where it fits. |

> [!WARNING]
> A private iCal link lets anyone who has it read that calendar. Treat it like a password, and don't share or post it. Calendar Enhanced + iCal keeps it in the phone's encrypted storage, which only the plugin can read.

### Google Calendar

1. Open [Google Calendar](https://calendar.google.com) on a computer.
2. Open Settings, then pick the calendar under Settings for My Calendars.
3. Under Integrate Calendar, copy **Secret address in iCal format**.
4. Paste it into iCal Feed 1 or iCal Feed 2, give the feed a name, and turn it on.

Each link covers one calendar, so a second Google calendar goes in the other feed. Outlook and iCloud also give an iCal link when you publish or share a calendar.

## Permissions

The plugin asks for three. Internet fetches the iCal links, and Calendar reads the phone's calendars through the built-in plugin. Timeline puts your iCal events on the timeline, only with Pin iCal Events to the Timeline on. None is required, so refusing one leaves the rest working.

## Data Source

Calendar Enhanced + iCal serves `calendar/event`, one instance per event, in the shapes the built-in Calendar plugin sends.

| Property | What It Holds |
| :-- | :-- |
| `name` | The event's title. |
| `location` | Where it is, when it has a place. |
| `description` | The event's notes as plain text, up to 300 characters, when it has any. |
| `starts_at` | When it starts, with a label as Time Labels sets it, its time on the phone's clock or its day. |
| `ends_at` | When it ends, with a label as well. |
| `all_day` | Whether it lasts all day. |
| `calendar` | The calendar or feed it came from. |

Each event goes out under an id made from its start and a fingerprint of its title, so a face sees the same event from one run to the next. An all-day event goes out from UTC midnight to UTC midnight, as the built-in sends one on Android.

## How It Works

The plugin has no timers. The Pebble app runs it about every five minutes while a face is subscribed, and again when the phone's calendars change. Each run reads the phone and both feeds side by side, merges them, and answers.

* **The Phone's Calendars** are read from the built-in Calendar plugin by its uuid, which reaches it even while Calendar Enhanced + iCal is the preferred source. The plugin asks it for 200 events with their notes, the most the Pebble app gives, and keeps the last good read in `localStorage`. A read that fails, such as one that times out, serves that kept read in its place for up to three hours. A read the wearer refused, such as one without the Calendar permission, drops it and leaves the feeds serving on their own. Turning Show Phone Calendars off drops it too. A slow read that finishes after a newer run never replaces that run's read, or brings back one refused since.
* **Each Feed** keeps its last good copy in `localStorage`, with a fingerprint of its link rather than the link. A run fetches the feed again once the copy reaches the iCal Refresh Interval, once the phone's midnight has passed since the fetch, or once the Look Ahead or Your Email Addresses change. A fetch that fails, or brings back something that is not iCal, keeps the copy and is tried again on the next run. A Public Holidays feed builds its link from the country each run, so the link is never saved, and it isn't secret. Turning a feed off, or changing or clearing its link, drops the copy. Beside the copy each feed keeps a status for the settings page, the time of its last good fetch, its count of events, and the kind of its last failure, such as `HTTP 404`, a timeout, or a site the Pebble app hasn't allowed, but never the link or the error's own text.
* **The Agenda** runs from today to the end of the Look Ahead's last day on the phone's clock, soonest first. It holds as many events as the face asks for, up to 200, and 20 for a face that names no number. An event on the phone and in a feed shows once, as the phone's copy, when the two have the same title, the same start, and the same all-day flag. An event both feeds carry shows once when it has the same UID and start in each.
* **The Filters** come before the cap, so a hidden event makes room for the next one. The answer is marked good only until the next event in it ends or Hide Events in Progress takes it off, when that comes before the usual five minutes.

The iCal links go to `Pebble.secureStorage`, which the phone encrypts and only the plugin can read. The other settings go to `localStorage`.

## Known Limitations

**Event Availability**

* Phone events stop at 7 days ahead, and at 200 events, since that is all the built-in plugin serves.
* The agenda holds 20 events across the phone and both feeds, unless a face asks for more, up to 200. Each feed gives at most 200.
* Every face reading Calendar Enhanced + iCal gets the same agenda.
* Two phone calendars with the same name share one switch, since the built-in sends only a calendar's name.

**Event Status**

* A cancelled event on an iPhone still shows from the phone's calendars, and Hide Declined, Tentative, and Free Events only reach your iCal feeds, since the built-in sends no status or availability. A phone event one of your feeds also holds takes that feed's marks. A cancelled event from a feed is always left out.

**All-Day Events**

* West of UTC, today's all-day events from the phone drop out of the agenda in the evening, since the built-in ends them at UTC midnight.
* On a phone at UTC+13 or further east, such as New Zealand in summer, an all-day event reads a day late. The built-in's own all-day events do the same there, and matching the built-in keeps every face reading the two the same way.

**Public Holidays**

* The holiday calendars come from Google's public holiday calendars. Google doesn't document their address, so it could change without notice.

**Duplicates**

* An event both feeds carry, where one feed has moved it, shows twice.

**Refreshing**

* The runtime has no timers, so a feed's host that never answers is only cut off where the runtime offers `AbortSignal.timeout`, after 8 seconds.
* While every read of the phone times out, the phone's part of the agenda is the last good read, for up to three hours, so an event changed on the phone since then shows as it was. After three hours the phone's part is empty until a read comes through.
* The pins only change while a watchface or a complication is reading your calendar, since that's when the Pebble app runs the plugin. Turning the pins off clears them when you save. The Pebble app never says whether a pin went in, so pins asked for while Timeline isn't allowed go in once you allow it.
* A meeting Hide Events in Progress takes off can stay on a face until the Pebble app next runs the plugin, up to five minutes, since the Pebble app runs it on its own schedule.

## Building

The unit pins [Pebble App Framework](https://github.com/AKlitbo/pebble-app-framework) 6.2.0 in its `paf.config.json`, and needs `paf 2.2.0` or later.

```sh
paf sync
paf build calendar-ical  # the .pbw, from WSL with Pebble SDK 4.44 and pebble-tool 5.1.2 or later
paf test
paf lint
paf typecheck
paf check
```

The pbw lands in `plugins/calendar-ical/targets/calendar-ical/build/`. The plugin's script starts in `src/plugin/index.ts` and its settings page in `src/config/index.ts`. The framework bundles both, with ical.js inside `plugin.js` under its MPL 2.0 licence, as [NOTICES.md](../../NOTICES.md) lists.
