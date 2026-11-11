# Third-Party Notices

The plugins in this repository are under the AGPL-3.0-or-later, see [LICENSE](LICENSE). They bundle the third-party work below, each of which keeps its own licence. This file is how those licences are passed on to anyone a plugin or this repository is given to.

## Code

### ical.js

The iCal reader in Calendar + iCal, which reads the wearer's iCal links. It reaches the plugin through the framework's calendar reader.

- **Source:** <https://github.com/kewisch/ical.js>
- **Licence:** Mozilla Public License 2.0, published at <https://www.mozilla.org/en-US/MPL/2.0/>. The full text also ships in the package at `node_modules/ical.js/LICENSE`
- **What Ships:** the package's own prebuilt `dist/ical.es5.min.cjs`, unmodified, bundled into the plugin's `plugin.js` with its licence header kept. The Pebble app loads a plugin's script as one file, so ical.js cannot ship beside it in a file of its own as it does in a watchface. The source that produced it is the upstream repository above

The MPL covers ical.js and nothing else here. The MPL 2.0 is compatible with the AGPL through its secondary licence provision.
