# Changelog

All notable changes to Stocks + Crypto are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.1] - 2026-11-12

### Fixed

- Fixed a call that timed out, or whose answer was lost, not counting against your provider's limit, which could run a free Alpha Vantage key out of its 25 a day early.
- Fixed a phone that was offline for hours spending a call for every ticker on every try. It now tries one ticker until the provider answers again.
- Fixed a phone offline since you set the plugin up, or since a new key, fetching every ticker on every run.

## [1.0.0] - 2026-11-11

### Added

- First release of the Stocks + Crypto plugin.
