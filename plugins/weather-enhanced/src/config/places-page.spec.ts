// @vitest-environment jsdom
/**
 * Specs for the place list page code, run against a stand-in for the Clay page and the plugin's real
 * answers to the page.
 *
 * The list lives in a hidden row the framework saves with the rest of the page, so whatever the page
 * code writes there is what every watchface gets. What is pinned is that the row always holds what the
 * wearer sees: the order and switches the plugin sent, each move and switch as it happens, each place
 * added or removed, and the wearer's saved choices left alone for the Pebble app places the plugin could
 * not read or a read left out. The framework's load can land after the plugin's answer, so that order
 * is pinned too. The hidden `PLACES` row has to ride through a save until the list holds the Pebble
 * app's places, and a place with no fix has to be marked and left out of the count, as the run skips it.
 *
 * Add a Place is pinned from the pick to the saved entry: the name filled from the pick, the wearer's
 * own name kept, the plugin's check that rounds the coordinates and turns away a place it would drop,
 * a full id every time, and the cap of five added places. Typing that clears the pick fires change, so
 * that is pinned against the fake search row too.
 */

import { describe, test, expect, vi } from 'vitest';
import type { ClayConfigItem } from '../../paf/ts/clay/types';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';
import { IMPERIAL_UNITS, appPlace, bridgeWith } from '../plugin/testing/fake-bridge';
import { clayConfig } from './index';
import type { ClayPage } from '../../paf/ts/plugin-app/page-types';
import placesPage from './places-page';
import type { PlacesOptions } from './places-page';

/** The Pebble app's list: Toronto, the current location named for its city, and London. */
const APP_LIST: SourceEnvelope = {
  instances: [appPlace('toronto', 'Toronto', [43.65, -79.38]), appPlace('here', 'Ottawa', [45.42, -75.69], true), appPlace('london', 'London', [51.51, -0.13])],
};

/** What the location search holds after a pick of Wakefield, Quebec. */
const WAKEFIELD = JSON.stringify({ lat: 45.638912, lon: -75.925678, label: 'Wakefield, Quebec, Canada', offset: -300, tz: 'America/Toronto' });

/** What the location search holds after a pick of Chelsea, Quebec. */
const CHELSEA = JSON.stringify({ lat: 45.5, lon: -75.8, label: 'Chelsea, Quebec, Canada', offset: -300, tz: 'America/Toronto' });

/** Every row on the page, sections opened up. */
function rows(items: ClayConfigItem[]): ClayConfigItem[] {
  return items.flatMap((item) => (item.items ? rows(item.items) : [item]));
}

/** Lets every answer already given land. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

/** A saved place list in the form the page writes it, Pebble app places by id and switch. */
function saved(entries: Array<[string, boolean] | Record<string, unknown>>): string {
  return JSON.stringify(entries.map((entry) => (Array.isArray(entry) ? { id: entry[0], app: true, on: entry[1] } : entry)));
}

/** An added place as the page saves it. */
function added(id: string, name: string): Record<string, unknown> {
  return { id, on: true, name, lat: 45.5, lon: -75.5 };
}

/**
 * A stand-in for one Clay row, holding a value and the change handlers Clay would call. Clay's own
 * rows fire change when set to a new value, and the location search fires it only on a pick.
 */
function fakeRow(value: unknown, firesOnSet: boolean, element: HTMLElement = document.createElement('div')) {
  const handlers: Record<string, Array<() => void>> = {};
  const fire = (event: string) => (handlers[event] || []).forEach((run) => run());
  const row = {
    value,
    hidden: false,
    config: {},
    $element: [element],
    get: () => row.value,
    set: (next: unknown) => {
      const changed = String(next) !== String(row.value);

      row.value = next;

      if (changed && firesOnSet) {
        fire('change');
      }
    },
    hide: () => void (row.hidden = true),
    on: (event: string, run: () => void) => void (handlers[event] = (handlers[event] || []).concat(run)),
    fire,
  };

  return row;
}

/**
 * Opens the page code with this place list in the hidden row and these settings saved behind the
 * plugin, which answers the places read the way given.
 */
async function openPage(list: string, readPlaces: () => Promise<SourceEnvelope> = async () => APP_LIST, settings: Record<string, unknown> = { PLACE_LIST: list }) {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="holder"></div><div id="note"><p></p></div>';

  const holderConfig = rows(clayConfig).find((item) => typeof (item.moduleOptions as Partial<PlacesOptions> | undefined)?.placesMessage === 'string') as ClayConfigItem;
  const options = holderConfig.moduleOptions as PlacesOptions;
  const store = fakeRow(list, true);
  const useApp = fakeRow(settings.USE_APP_PLACES !== false, true);
  const oldPlaces = fakeRow(settings.PLACES ?? '', true);
  const search = fakeRow('', false);
  const name = fakeRow('', true);
  const add = fakeRow(undefined, false);
  const note = fakeRow('', false, document.getElementById('note') as HTMLElement);
  const holder = { ...fakeRow('', false, document.getElementById('holder') as HTMLElement), config: { moduleOptions: options } };
  const byId: Record<string, unknown> = { [options.searchId]: search, [options.nameId]: name, [options.addId]: add, [options.addNoteId]: note };
  const byKey: Record<string, unknown> = { [options.listKey]: store, [options.useAppKey]: useApp, [options.oldPlacesKey]: oldPlaces };
  const ask = bridgeWith(async () => IMPERIAL_UNITS, { readPlaces, settings });
  let built: () => void = () => undefined;
  let ready: (event: { target: string }) => void = () => undefined;
  const page = {
    EVENTS: { AFTER_BUILD: 'after-build' },
    on: (_event: string, run: () => void) => void (built = run),
    getAllItems: () => [useApp, holder, store, oldPlaces, search, name, add, note],
    getItemById: (id: string) => byId[id] as ReturnType<typeof fakeRow> | undefined,
    getItemByMessageKey: (key: string) => byKey[key] as ReturnType<typeof fakeRow> | undefined,
  };

  (window as unknown as { Pebble: unknown }).Pebble = {
    addEventListener: (event: string, listener: typeof ready) => void (event === 'ready' ? (ready = listener) : undefined),
    sendMessage: (_target: string, message: unknown) => ask(message),
  };

  // the stand-in has only the parts of the Clay page the page code reaches
  placesPage.call(page as unknown as ClayPage);
  built();
  ready({ target: 'plugin' });
  await settle();

  return {
    /** The hidden row's list as id and switch. */
    stored: () => (JSON.parse(String(store.value)) as Array<{ id: string; on: boolean }>).map((entry) => [entry.id, entry.on]),
    /** The hidden row's list as the page wrote it. */
    entries: () => JSON.parse(String(store.value)) as Array<Record<string, unknown>>,
    raw: () => String(store.value),
    /** The rows as the wearer reads them, each name with its tag and switch. */
    shown: () => [...document.querySelectorAll('.we-places li')].map((row) => [row.querySelector('.we-name')?.textContent, row.querySelector('.we-tag')?.textContent, (row.querySelector('input') as HTMLInputElement).checked]),
    names: () => [...document.querySelectorAll('.we-places .we-name')].map((row) => row.textContent),
    count: () => document.querySelector('.we-count')?.textContent,
    status: () => document.querySelector('.we-status')?.textContent,
    note: () => document.querySelector('#note p')?.textContent,
    tap: (label: string) => (document.querySelector(`[aria-label="${label}"]`) as HTMLElement).click(),
    /** The framework setting the row from the saved settings. */
    load: (next: string) => store.set(next),
    /** The hidden row carrying a saved Places to Fetch, as a save would send it. */
    oldPlaces: () => oldPlaces.value,
    /** The framework setting that row from the saved settings. */
    loadOldPlaces: (next: string) => oldPlaces.set(next),
    /** The wearer flipping Pebble App Places. */
    useApp: (on: boolean) => useApp.set(on),
    /** The wearer picking a place from the search list, as the location search sets its value and fires change. */
    pick: (value: string) => {
      search.value = value;
      search.fire('change');
    },
    /** The wearer typing in the search, which clears its pick and fires change. */
    clearPick: () => {
      search.value = '';
      search.fire('change');
    },
    /** The wearer typing a name over the one filled in. */
    typeName: (value: string) => void (name.value = value),
    name: () => name.value,
    search: () => search.value,
    /** The wearer tapping Add, with the plugin's check of the place let land. */
    add: async () => {
      add.fire('click');
      await settle();
    },
    /** Whether the Add a Place rows are hidden. */
    addHidden: () => [search, name, add].map((row) => row.$element[0].style.display === 'none'),
  };
}

describe('the place list', () => {
  /** A row in another order, or the current location not marked, would show the wearer something other than what faces get. */
  test('draws the places in the saved order with their switches and the current location tagged', async () => {
    const page = await openPage(saved([['london', true], ['toronto', false]]));

    const result = page.shown();

    expect(result).toEqual([
      ['London', undefined, true],
      ['Toronto', undefined, false],
      ['Ottawa', 'Current Location', true],
    ]);
  });

  /** A saved First Location Only is read only until the next save, so that save has to carry it over as a list. */
  test('writes the list to the row as soon as the plugin answers', async () => {
    const page = await openPage('[]', async () => APP_LIST, { PLACE_LIST: '[]', PLACES: 'first' });

    const result = page.stored();

    expect(result).toEqual([
      ['toronto', true],
      ['here', false],
      ['london', false],
    ]);
  });

  /** A switch that changed only on the page would be lost on Save, and faces would keep the place. */
  test('saves a place switched off', async () => {
    const page = await openPage('[]');

    page.tap('Show London on watchfaces');
    const result = page.stored();

    expect(result).toEqual([
      ['toronto', true],
      ['here', true],
      ['london', false],
    ]);
  });

  /** A face showing one place shows the top one, so a move has to reach the saved order. */
  test('saves a place moved up', async () => {
    const page = await openPage('[]');

    page.tap('Move London up');
    const result = [page.stored(), page.names()];

    expect(result).toEqual([
      [
        ['toronto', true],
        ['london', true],
        ['here', true],
      ],
      ['Toronto', 'London', 'Ottawa'],
    ]);
  });

  /** The plugin answers the load and the places ask in any order, and the load landing last must not undo the list it showed. */
  test('puts the list back over a load that lands after the answer', async () => {
    const page = await openPage('[]', async () => APP_LIST, { PLACES: 'first' });
    const shownList = page.raw();

    page.load('[]');
    const result = page.raw();

    expect(result).toBe(shownList);
  });

  /**
   * A read refused before the wearer allows Location has no Pebble app places to show. Their saved
   * entries have to stay in the row where they were, or the next save wipes their order, and the added
   * places still show so they can be changed.
   */
  test('keeps the unread places in the row and shows the added ones when the read is refused', async () => {
    const list = saved([['london', true], added('own-a', 'Cottage'), ['toronto', false]]);
    const page = await openPage(list, () => Promise.reject(Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' })));

    const result = [page.raw(), page.names(), page.status()];

    expect(result).toEqual([list, ['Cottage'], "Could not read the Pebble app's weather list, so its places stay as they were saved. Check that Weather Enhanced is allowed Location."]);
  });

  /** A current location with no fix is skipped by every run until it has one, so counting it promised the wearer a place faces never got. */
  test('marks a place with no fix and leaves it out of the count', async () => {
    const noFix = { instances: [appPlace('here', '', undefined, true), appPlace('toronto', 'Toronto', [43.65, -79.38])] };
    const page = await openPage('[]', async () => noFix);

    const result = [page.shown(), page.count()];

    expect(result).toEqual([
      [
        ['Current Location', 'No Fix Right Now', true],
        ['Toronto', undefined, true],
      ],
      '1 place on.',
    ]);
  });

  /**
   * The Pebble app can list a place it is still setting up, a key with nothing else yet. A row with no
   * name at all gave the wearer nothing to tell it by, and counting it promised weather faces never got.
   */
  test('names a place with nothing but its key and leaves it out of the count', async () => {
    const page = await openPage('[]', async () => ({ instances: [{ instanceId: 'setting-up' }, appPlace('toronto', 'Toronto', [43.65, -79.38])] }));

    const result = [page.shown(), page.count()];

    expect(result).toEqual([
      [
        ['Unnamed Place', 'No Fix Right Now', true],
        ['Toronto', undefined, true],
      ],
      '1 place on.',
    ]);
  });

  /** With only a place with no fix on, faces get nothing from the plugin, and the page must not count that as a place. */
  test('says no place on has a fix when the only one on has none', async () => {
    const noFix = { instances: [appPlace('here', '', undefined, true), appPlace('toronto', 'Toronto', [43.65, -79.38])] };
    const page = await openPage(saved([['here', true], ['toronto', false]]), async () => noFix);

    const result = page.count();

    expect(result).toBe('No place that is on has a fix right now, so watchfaces get no weather from Weather Enhanced until one does.');
  });

  /**
   * A read that left out a saved place, as the Pebble app can for a current location with no fix,
   * dropped its entry, so the next save lost the wearer's order and its off switch.
   */
  test('keeps a saved place the read left out in the row, with no row of its own', async () => {
    const list = saved([['here', false], ['toronto', true]]);
    const page = await openPage(list, async () => ({ instances: [appPlace('toronto', 'Toronto', [43.65, -79.38])] }));

    const result = [page.stored(), page.names()];

    expect(result).toEqual([
      [
        ['here', false],
        ['toronto', true],
      ],
      ['Toronto'],
    ]);
  });

  /** Saving with every place off leaves faces with no weather at all, so the page says so before the wearer saves. */
  test('warns when every place is switched off', async () => {
    const page = await openPage(saved([['toronto', false], ['here', false], ['london', true]]));

    page.tap('Show London on watchfaces');
    const result = page.count();

    expect(result).toBe('No place is on, so watchfaces get no weather from Weather Enhanced.');
  });
});

describe('Places to Fetch from before the list', () => {
  /** The list carries First Location Only once it holds the Pebble app's places, so the old setting can go with that save. */
  test("clears the old setting once the list holds the Pebble app's places", async () => {
    const page = await openPage('[]', async () => APP_LIST, { PLACE_LIST: '[]', PLACES: 'first' });

    const result = [page.stored(), page.oldPlaces()];

    expect(result).toEqual([
      [
        ['toronto', true],
        ['here', false],
        ['london', false],
      ],
      '',
    ]);
  });

  /** The load landing after the answer would bring the old setting back over a list that already carries it. */
  test('clears the old setting again when the load lands after the answer', async () => {
    const page = await openPage('[]', async () => APP_LIST, { PLACE_LIST: '[]', PLACES: 'first' });

    page.loadOldPlaces('first');
    const result = page.oldPlaces();

    expect(result).toBe('');
  });

  /**
   * A save replaces every setting. With the Pebble app's list empty for a moment the page saves an empty
   * list, and dropping First Location Only then gave the wearer up to five places on the next run.
   */
  test('keeps First Location Only through a save with an empty list', async () => {
    const page = await openPage('[]', async () => ({ instances: [] }), { PLACE_LIST: '[]', PLACES: 'first' });

    const result = [page.raw(), page.oldPlaces()];

    expect(result).toEqual(['[]', 'first']);
  });

  /** A list holding only an added place says nothing about the Pebble app's places, so First Location Only must ride along. */
  test('keeps First Location Only when a place is added to an empty list', async () => {
    const page = await openPage('[]', async () => ({ instances: [] }), { PLACE_LIST: '[]', PLACES: 'first' });

    page.pick(WAKEFIELD);
    await page.add();
    const result = [page.entries().map((entry) => entry.name), page.oldPlaces()];

    expect(result).toEqual([['Wakefield'], 'first']);
  });
});

describe('Pebble App Places', () => {
  /**
   * Off, the Pebble app's places reach no face, so their rows go. Their entries stay in the row, so
   * switching it back on brings back the order and switches the wearer had.
   */
  test("hides the Pebble app's rows and keeps them in the list", async () => {
    const list = saved([['london', true], added('own-a', 'Cottage'), ['toronto', false], ['here', true]]);
    const page = await openPage(list);

    page.useApp(false);
    const result = [page.names(), page.raw(), page.count()];

    expect(result).toEqual([['Cottage'], list, '1 place on.']);
  });

  /** A move past a hidden row has to land the place where the wearer sees it go. */
  test('moves an added place above the one shown before it while the rows hide', async () => {
    const page = await openPage(saved([added('own-a', 'Cottage'), ['london', true], added('own-b', 'Lake'), ['toronto', true], ['here', true]]), async () => APP_LIST, {
      PLACE_LIST: saved([added('own-a', 'Cottage'), ['london', true], added('own-b', 'Lake'), ['toronto', true], ['here', true]]),
      USE_APP_PLACES: false,
    });

    page.tap('Move Lake up');
    const result = [page.names(), page.stored().map((entry) => entry[0])];

    expect(result).toEqual([['Lake', 'Cottage'], ['own-b', 'own-a', 'london', 'toronto', 'here']]);
  });
});

describe('Add a Place', () => {
  /** The geocoder's label names the region and country, which runs off a watchface, so the name starts as the town alone. */
  test('fills the name from the pick', async () => {
    const page = await openPage('[]');

    page.pick(WAKEFIELD);
    const result = page.name();

    expect(result).toBe('Wakefield');
  });

  /**
   * An added place keeps its own coordinates under an id made once, at the bottom and switched on.
   * Coordinates finer than four decimals would serve a place a hair from the one the plugin reads back.
   */
  test('adds the picked place at the bottom, on, under a new id', async () => {
    const page = await openPage('[]');

    page.pick(WAKEFIELD);
    await page.add();
    const entries = page.entries();
    const result = [entries.length, entries[3], page.shown()[3], page.search(), page.name()];

    expect(result).toEqual([4, { id: expect.stringMatching(/^own-[a-z0-9]+$/), on: true, name: 'Wakefield', lat: 45.6389, lon: -75.9257 }, ['Wakefield', 'Added Here', true], '', '']);
  });

  /** The name is the wearer's to change, and Add must not put the pick's back over it. */
  test("keeps the wearer's own name", async () => {
    const page = await openPage('[]');

    page.pick(WAKEFIELD);
    page.typeName('  The Cottage  ');
    await page.add();
    const result = page.entries()[3].name;

    expect(result).toBe('The Cottage');
  });

  /**
   * The plugin drops a saved place whose coordinates are off the globe. Added as it was, such a place
   * saved, then vanished on the next read with nothing said, so the plugin checks it first.
   */
  test('adds nothing and says so for a pick the plugin turns away', async () => {
    const page = await openPage('[]');

    page.pick(JSON.stringify({ lat: 95, lon: -75.9, label: 'Nowhere', offset: 0, tz: '' }));
    await page.add();
    const result = [page.entries().length, page.note()];

    expect(result).toEqual([3, 'Weather Enhanced could not add that place. Pick it from the search list again.']);
  });

  /** A random number can write out short in base 36, which made an id of the prefix alone that a second add would share. */
  test('makes a full id when the random letters come out short', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const page = await openPage('[]');

    page.pick(WAKEFIELD);
    await page.add();
    random.mockRestore();
    const result = page.entries()[3].id;

    expect(result).toBe('own-iiiiii');
  });

  /** A new place is a new pick, so its town replaces the name of the place picked before it. */
  test('fills the name again for a different place', async () => {
    const page = await openPage('[]');

    page.pick(WAKEFIELD);
    page.typeName('The Cottage');
    page.pick(CHELSEA);
    const result = page.name();

    expect(result).toBe('Chelsea');
  });

  /**
   * Typing in the search clears its pick and fires change. Adding then would save the old pick's
   * coordinates under whatever the box now says, so Add is refused until a place is picked again.
   */
  test('adds nothing once typing clears the pick', async () => {
    const page = await openPage('[]');

    page.pick(WAKEFIELD);
    page.clearPick();
    await page.add();
    const result = [page.entries().length, page.note(), page.name()];

    expect(result).toEqual([3, 'Pick a place from the search list first.', 'Wakefield']);
  });

  /** A place cleared and picked again is picked anew, so its town fills the name again. */
  test('fills the name again for the same place picked after a clear', async () => {
    const page = await openPage('[]');

    page.pick(WAKEFIELD);
    page.typeName('The Cottage');
    page.clearPick();
    page.pick(WAKEFIELD);
    const result = page.name();

    expect(result).toBe('Wakefield');
  });

  /** A name typed and never picked has no coordinates, and saving it would serve nothing. */
  test('adds nothing without a pick', async () => {
    const page = await openPage('[]');

    page.typeName('Cottage');
    await page.add();
    const result = [page.entries().length, page.note()];

    expect(result).toEqual([3, 'Pick a place from the search list first.']);
  });

  /** A Remove that changed only the page would leave faces showing the place after Save. */
  test('removes an added place', async () => {
    const page = await openPage(saved([['toronto', true], added('own-a', 'Cottage'), ['here', true], ['london', true]]));

    page.tap('Remove Cottage');
    const result = [page.stored().map((entry) => entry[0]), page.names()];

    expect(result).toEqual([['toronto', 'here', 'london'], ['Toronto', 'Ottawa', 'London']]);
  });

  /** The plugin reads only five added places, so a sixth would be dropped silently after Save. */
  test('hides Add a Place once five places are added', async () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((letter) => added(`own-${letter}`, `Place ${letter}`));
    const page = await openPage(saved(five));

    const result = [page.addHidden(), page.note()];

    expect(result).toEqual([[true, true, true], '5 places added, the most there can be. Remove one to add another.']);
  });

  /** An add before the plugin answers would write a list of one place over the saved list. */
  test('keeps Add a Place hidden until the plugin answers', async () => {
    const page = await openPage('[]', () => new Promise(() => undefined));

    const result = page.addHidden();

    expect(result).toEqual([true, true, true]);
  });
});
