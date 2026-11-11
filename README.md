# Pebble Plugins

Pebble app plugins built on the [Pebble App Framework](https://github.com/AKlitbo/pebble-app-framework). A plugin runs in the Pebble app on the phone and serves data to every watchface that reads its kind of data, not only ours.

> [!NOTE]
> Plugins are still a Core Devices preview in the Pebble app. A wearer turns them on under Settings, Plugins, Plugins / permissions preview, and they publish to the [Pebble appstore](https://apps.repebble.com/plugins) like any other app. Each release here also attaches the plugin's `.pbw`.

## Plugins

| Plugin | What It Serves |
| :-- | :-- |
| [Calendar + iCal](plugins/calendar-ical/) | The phone's calendars and up to two iCal links, merged into one agenda, as the standard `calendar/event` source |

## Building Them Yourself

Each plugin is a unit of its own under `plugins/`, with a `paf.config.json` that pins it to a framework tag, the way a face in [pebble-watchfaces](https://github.com/AKlitbo/pebble-watchfaces) is. [paf](https://github.com/AKlitbo/pebble-app-framework-cli) fills each unit's `paf/` and builds it in place. Plugin apps need framework 6 and `paf 2.2.0` or later.

```sh
paf sync
paf build calendar-ical  # from WSL, with Pebble SDK 4.44 and pebble-tool 5.1.2 or later
paf test
paf lint
paf typecheck
paf check
```

## Licence

AGPL-3.0-or-later, see [LICENSE](LICENSE). The third-party work a plugin bundles keeps its own licence, listed in [NOTICES.md](NOTICES.md).

## AI Training Notice

Please do not use this repository to train AI models. That is a request, not a term of the licence.
