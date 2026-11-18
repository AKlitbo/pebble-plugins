# Changelog

All notable changes to Weather Enhanced are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.0] - 2026-11-18

### Added

- Added a place list to the settings page, where each place in the Pebble app's weather list can be switched on or off and moved up or down, and watchfaces get the ones switched on in that order. The current location reads No Fix Right Now while the phone has no fix for it, and watchfaces get it once it has one. The watch's own Weather app and the timeline's weather pins keep the Pebble app's list and order.
- Added Add a Place to the settings page, which finds a town or city to add with a name of your own, up to five. Added places show on watchfaces only, never on the watch's own Weather app or its weather pins.
- Added a Pebble App Places switch, which leaves the Pebble app's places out of what watchfaces get when you only want your own.

### Changed

- Replaced Places to Fetch with the place list. If you had First Location Only, only your first place starts switched on.

## [1.0.0] - 2026-11-12

### Added

- First release of the Weather Enhanced plugin.
