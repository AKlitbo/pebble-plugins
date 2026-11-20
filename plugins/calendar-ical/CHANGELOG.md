# Changelog

All notable changes to Calendar Enhanced + iCal are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.3.0] - 2026-11-20

### Added

- Added each event's notes, which watchfaces now get from your phone's calendars and your iCal feeds alike, as they do from the built-in Calendar plugin.
- Added Hide Declined Events, Hide Tentative Events, and Hide Free Events switches, so the next event on your watch is one you're going to. They reach your iCal feeds, and a phone event one of your feeds also holds, since the Pebble app doesn't share whether you're going to a phone event. Hide Declined Events, and Hide Tentative Events for invitations you answered Maybe to, need your email addresses.
- Added Public Holidays as a Source for either feed, with 38 countries to pick from. The feed takes the country's holiday name unless you've named it, and Include Observances adds days such as Valentine's Day that aren't days off.
- Added a switch for each of your phone's calendars, so a calendar can show on your timeline without showing on your watchfaces. The list shows the calendars with events in the next 7 days, and any you've switched off.
- Added a Hide Events Titled box, which keeps events whose titles have any of the words you list, such as Lunch, Focus Time, or Canceled:, off your watch.
- Added a Pin iCal Events to the Timeline switch, off by default, which puts your iCal feeds' events on your watch's timeline with a reminder you pick. The Pebble app asks you to allow Timeline the first time. The pins change only while a watchface or complication is showing your calendar.
- Added a Time Labels setting for watchfaces that show an event's time as text. Short writes 2:30p on a 12-hour clock, and Thu or Nov 27 for an event on another day. Same as the Pebble App, the default, keeps 14:30.
- Added a status under each iCal feed on the settings page, showing when it was last fetched, how many events it gave, and its last error, such as a timeout or a site the Pebble app hasn't allowed.

### Fixed

- Fixed your phone's events dropping off the watch when one read of your phone's calendars was slow. The agenda keeps the last good read for up to three hours, until the next one comes through.
- Fixed a busy week showing only the first 10 of your phone's events. A watchface that asks for more than 20 events now gets them too.

### Notes

- Your iCal feeds' events gain their notes, and their declined, tentative, and free marks, at the feed's next fetch, at most one iCal Refresh Interval after the update.

## [1.2.0] - 2026-11-18

### Added

- Added a Hide Events in Progress setting, which takes a meeting off the agenda when it starts, or once it has been going 15, 30, or 60 minutes. All-day events, and anything that runs a day or more, stay until they end.
- Added a Show All-Day Events switch, on by default. Turn it off to keep all-day reminders and statuses from crowding out your next meeting.

### Changed

- Renamed the plugin to Calendar Enhanced + iCal.

## [1.1.0] - 2026-11-12

### Added

- Added a Look Ahead setting, from Today to 1 Month, for how far ahead the agenda goes. Your iCal feeds follow it in full, but your phone's calendars stop at a week, since that's all the Pebble app shares.

## [1.0.1] - 2026-11-11

### Fixed

- Fixed a gap under the Refresh Interval dropdown on the settings page in the Pebble Android app.

## [1.0.0] - 2026-11-10

### Added

- First release of the Calendar + iCal plugin.
