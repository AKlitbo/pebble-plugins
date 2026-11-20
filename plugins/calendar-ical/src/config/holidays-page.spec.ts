/**
 * Specs for the page code that names a Public Holidays feed after its country, run against a stand-in
 * for the Clay page built from the real page's rows.
 *
 * What is pinned is the Name the wearer sees and saves. A feed with no name of its own has to follow
 * the country picked. A name the wearer typed must never be touched, picking iCal Link never renames,
 * and neither must a saved name change when Clay fills the saved settings in.
 */

import { describe, test, expect } from 'vitest';
import type { ClayConfigItem } from '../../paf/ts/clay/types';
import type { ClayPage, ClayPageRow } from '../../paf/ts/plugin-app/page-types';
import { clayConfig } from './index';
import holidaysPage from './holidays-page';

/** Every row on the page, sections opened up. */
function rows(items: ClayConfigItem[]): ClayConfigItem[] {
  return items.flatMap((item) => (item.items ? rows(item.items) : [item]));
}

/**
 * A row as Clay draws it, holding a value. Clay's `set` fires Clay's own `change`, which the page code
 * must not hear, and `pick` stands in for the wearer choosing in the select, which fires its own.
 */
function row(config: ClayConfigItem, value: unknown) {
  const picks: Array<() => void> = [];
  const select = { addEventListener: (name: string, listener: () => void) => void (name === 'change' ? picks.push(listener) : undefined) };
  let held = value;

  return {
    config,
    $element: [{ querySelector: (selector: string) => (selector === 'select' && config.type === 'select' ? select : null) }],
    get: () => held,
    set: (next: unknown) => void (held = next),
    pick: (next: unknown) => {
      held = next;
      picks.forEach((listener) => listener());
    },
  };
}

/** Opens the page code over both feeds' rows holding these values, the second on its defaults when left out. */
function openPage(values: { source: string; country: string; name: string }, second = { source: 'ical', country: 'us', name: 'Feed 2' }) {
  const all = rows(clayConfig);
  const byKey = (key: string) => all.find((item) => item.messageKey === key) as ClayConfigItem;
  const feed = {
    FEED1_SOURCE: row(byKey('FEED1_SOURCE'), values.source),
    FEED1_COUNTRY: row(byKey('FEED1_COUNTRY'), values.country),
    FEED1_NAME: row(byKey('FEED1_NAME'), values.name),
    FEED2_SOURCE: row(byKey('FEED2_SOURCE'), second.source),
    FEED2_COUNTRY: row(byKey('FEED2_COUNTRY'), second.country),
    FEED2_NAME: row(byKey('FEED2_NAME'), second.name),
  };
  let built: () => void = () => undefined;
  const page = {
    EVENTS: { AFTER_BUILD: 'after-build' },
    on: (_event: string, run: () => void) => void (built = run),
    getAllItems: () => Object.values(feed) as unknown as ClayPageRow[],
    getItemByMessageKey: (key: string) => (feed as Record<string, unknown>)[key] as ClayPageRow | undefined,
  };

  // the stand-in has only the parts of the Clay page the page code reaches
  holidaysPage.call(page as unknown as ClayPage);
  built();

  return feed;
}

describe('the holiday feed names', () => {
  /** A feed the wearer never named would otherwise go out as Feed 1, which says nothing about whose holidays they are. */
  test('names an unnamed feed after the country when Public Holidays is picked', () => {
    const feed = openPage({ source: 'ical', country: 'ca', name: 'Feed 1' });

    feed.FEED1_SOURCE.pick('holidays');

    const result = feed.FEED1_NAME.get();

    expect(result).toBe('Canada Holidays');
  });

  /** The name has to follow the country while the wearer has not named it, or it names the wrong country. */
  test('renames the feed when another country is picked', () => {
    const feed = openPage({ source: 'holidays', country: 'ca', name: 'Canada Holidays' });

    feed.FEED1_COUNTRY.pick('gb');

    const result = feed.FEED1_NAME.get();

    expect(result).toBe('UK Holidays');
  });

  /** A name the wearer typed is theirs. */
  test('keeps a name the wearer typed', () => {
    const feed = openPage({ source: 'holidays', country: 'ca', name: 'Days Off' });

    feed.FEED1_COUNTRY.pick('gb');

    const result = feed.FEED1_NAME.get();

    expect(result).toBe('Days Off');
  });

  /** A wearer can type a name that matches a country's, and switching to a link must not throw it away. */
  test('leaves the name alone when iCal Link is picked', () => {
    // the wearer typed UK Holidays over a Canadian feed's name, then switches to a link
    const feed = openPage({ source: 'holidays', country: 'ca', name: 'UK Holidays' });

    feed.FEED1_SOURCE.pick('ical');

    const result = feed.FEED1_NAME.get();

    expect(result).toBe('UK Holidays');
  });

  /** The second feed has its own rows and its own default name, and must be named the same way. */
  test('names feed 2 after its country', () => {
    const feed = openPage({ source: 'ical', country: 'ca', name: 'Feed 1' }, { source: 'ical', country: 'jp', name: 'Feed 2' });

    feed.FEED2_SOURCE.pick('holidays');

    const result = [feed.FEED1_NAME.get(), feed.FEED2_NAME.get()];

    expect(result).toEqual(['Feed 1', 'Japan Holidays']);
  });

  /** Clay fills the saved settings in with `set`, and the page must leave the saved name as it is. */
  test('leaves the name alone while Clay fills the saved settings in', () => {
    const feed = openPage({ source: 'ical', country: 'us', name: 'Feed 1' });

    feed.FEED1_SOURCE.set('holidays');
    feed.FEED1_COUNTRY.set('ca');

    const result = feed.FEED1_NAME.get();

    expect(result).toBe('Feed 1');
  });
});
