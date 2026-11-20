/**
 * The page code on Calendar Enhanced + iCal's settings page that names a Public Holidays feed after its
 * country, such as US Holidays, until the wearer names it.
 *
 * Picking Public Holidays or a country fills the feed's Name with the country's holiday name, but only
 * while the Name holds nothing the wearer typed: empty, the feed's default, or any country's holiday
 * name. Those names come from `automaticNames` in src/holidays.ts, the same list the plugin reads a
 * saved name by, so the page and the watch always agree on whose holidays a feed holds. Picking iCal
 * Link leaves the Name alone, so a name typed to match a country is never lost. It listens for the selects' own `change` events rather than Clay's, since Clay's
 * `set` fires `change` when it fills the saved settings in, and a saved name must never be touched.
 *
 * Clay writes this into the page as text and runs it there, so it reaches nothing outside itself: no
 * imports but its types, which compile away, and no module-scope constants. The keys and the names
 * ride in on the first Country select's `moduleOptions`.
 */

import type { ClayPage } from '../../paf/ts/plugin-app/page-types';

/** What the first Country select hands the page code. */
export interface HolidaysOptions {
  /** Each feed's Source, Country, and Name message keys, and the names that count as filled in, in slot order. */
  feeds: Array<{ source: string; country: string; name: string; automatic: string[] }>;
  /** Each country's holiday name, by the value its Country choice saves. */
  names: Record<string, string>;
}

/** The page code Clay runs with the page as `this`. */
export default function holidaysPage(this: ClayPage): void {
  this.on(this.EVENTS.AFTER_BUILD, () => {
    const holder = this.getAllItems().find((item) => Boolean(item.config && item.config.moduleOptions && Array.isArray((item.config.moduleOptions as Partial<HolidaysOptions>).feeds)));
    const options = holder && (holder.config.moduleOptions as HolidaysOptions);

    if (!options) {
      return;
    }

    options.feeds.forEach((feed) => {
      const source = this.getItemByMessageKey(feed.source);
      const country = this.getItemByMessageKey(feed.country);
      const name = this.getItemByMessageKey(feed.name);

      if (!source || !country || !name) {
        return;
      }

      const rename = () => {
        const current = String(name.get() || '').trim();

        if (source.get() !== 'holidays' || (current && feed.automatic.indexOf(current) === -1)) {
          return;
        }

        const next = options.names[String(country.get())];

        if (next && next !== current) {
          name.set(next);
        }
      };

      [source, country].forEach((row) => {
        const select = row.$element[0] && row.$element[0].querySelector('select');

        if (select) {
          select.addEventListener('change', rename);
        }
      });
    });
  });
}
