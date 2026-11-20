/**
 * The page code on Calendar Enhanced + iCal's settings page that shows each feed's status under it:
 * when it was last fetched, how many events it gave, and its last failure since then.
 *
 * The page cannot read the plugin's storage itself, so once the plugin says it is ready, this asks it.
 * The plugin answers each feed's status for the link it has saved, and never the link. Typing in a
 * link, or picking another source, country, or observances, swaps its status for a note that the feed
 * is fetched after Save. The note listens for the box's own `input` and `change` events rather than
 * Clay's `change`, since Clay's `set` fires `change` when it fills the saved settings in, and Clay's own
 * events never reach the box. An ask that fails, is refused,
 * or never answers leaves the rows empty, and nothing on the page waits on it.
 *
 * Clay writes this into the page as text and runs it there, so it reaches nothing outside itself: no
 * imports but its types, which compile away, and no module-scope constants. The message and the row
 * names ride in on the first status row's `moduleOptions`.
 */

import type { ClayPage, PluginPageBridge } from '../../paf/ts/plugin-app/page-types';

/** What the first status row hands the page code. */
export interface StatusOptions {
  /** The plugin's status message. */
  statusMessage: string;
  /** Each feed's status row id, in slot order. */
  rows: string[];
  /** The message keys of each feed's rows whose edits change what it fetches, in slot order. */
  edits: string[][];
}

/** The page code Clay runs with the page as `this`. */
export default function statusPage(this: ClayPage): void {
  this.on(this.EVENTS.AFTER_BUILD, () => {
    const holder = this.getItemById('cei-status-1');
    const options = holder && (holder.config.moduleOptions as StatusOptions | undefined);
    const bridge = (window as unknown as { Pebble?: PluginPageBridge }).Pebble;

    if (!options || !bridge || typeof bridge.sendMessage !== 'function' || typeof bridge.addEventListener !== 'function') {
      return;
    }

    const show = (index: number, text: string) => {
      const row = this.getItemById(options.rows[index]);
      const element = row && row.$element[0];

      // textContent rather than HTML, so nothing in a status is ever read as markup
      if (element) {
        element.textContent = text;
      }
    };

    const when = (ms: unknown) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

    const why = (kind: unknown) => {
      if (typeof kind === 'string' && /^HTTP \d+$/.test(kind)) {
        return 'the server answered ' + kind;
      }

      if (kind === 'NOT_ICAL') {
        return "the link didn't give an iCal calendar";
      }

      if (kind === 'TIMEOUT') {
        return "the server didn't answer in time";
      }

      return kind === 'NOT_ALLOWED' ? "the Pebble app hasn't allowed the site" : "the fetch didn't go through";
    };

    const describe = (status: unknown) => {
      const known = status && typeof status === 'object' ? (status as { fetchedMs?: unknown; events?: unknown; error?: unknown; errorMs?: unknown }) : {};
      const fetched = when(known.fetchedMs);
      const count = typeof known.events === 'number' ? known.events : 0;
      const failed = known.error ? when(known.errorMs) : '';
      const parts = [fetched ? 'Last fetched ' + fetched + ', with ' + count + (count === 1 ? ' event.' : ' events.') : 'Not fetched yet.'];

      if (failed) {
        parts.push('The last try, ' + failed + ', failed, since ' + why(known.error) + '.');
      }

      return parts.join(' ');
    };

    options.edits.forEach((messageKeys, index) => {
      messageKeys.forEach((messageKey) => {
        const row = this.getItemByMessageKey(messageKey);
        const box = row && row.$element[0] && row.$element[0].querySelector('input, select');
        const note = () => show(index, 'This feed is fetched on the next run after you save.');

        if (box) {
          box.addEventListener('input', note);
          box.addEventListener('change', note);
        }
      });
    });

    bridge.addEventListener('ready', (event) => {
      if (event.target !== 'plugin') {
        return;
      }

      bridge.sendMessage('plugin', { type: options.statusMessage }).then((reply) => {
        const feeds = reply && typeof reply === 'object' ? (reply as { feeds?: unknown }).feeds : undefined;

        if (Array.isArray(feeds)) {
          options.rows.forEach((id, index) => show(index, describe(feeds[index])));
        }
      }).catch(() => undefined);
    });
  });
}
