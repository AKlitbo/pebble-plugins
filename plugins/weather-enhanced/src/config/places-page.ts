/**
 * The place list on Weather Enhanced's settings page: one row per place, in the order watchfaces get
 * them, each with arrows to move it and a switch, and Add a Place under it.
 *
 * The page cannot read the Pebble app's places itself, so once the plugin says it is ready, this asks
 * it. The plugin answers with every place already in the wearer's order, the Pebble app's and the added
 * ones, laid out from the same saved settings the page loads, so the order is worked out in one place.
 * The list lives in the page's hidden `PLACE_LIST` row as JSON, so the framework loads and saves it with
 * the other settings.
 *
 * The list is written to that row as soon as the plugin answers, so a save keeps the order shown even
 * when the wearer changed nothing. A Pebble app place the plugin could not read this time stays in the
 * list without a row, so a save keeps it where it was. Pebble App Places switched off hides the Pebble
 * app's rows the same way and keeps them in the list. An ask that fails or never answers leaves the row
 * as it loaded, and adding stays off, so a save then keeps the wearer's saved choices rather than
 * wiping them.
 *
 * The hidden `PLACES` row holds the Places to Fetch a Weather Enhanced 1.0.0 save carries. A save
 * replaces every setting, so the row rides through each one until the list holds a Pebble app place.
 * The list then carries First Location Only itself, and the row is emptied.
 *
 * Add a Place reads the pick from the framework's location search, which fires `change` once as each
 * pick lands, since the row takes no time zone, and again when typing clears the pick. Each pick fills
 * the Name, which the wearer can then change. Add sends the place to the plugin, which checks it,
 * rounds its coordinates, and trims its name the way it reads every saved place, and the page adds the
 * entry it hands back. A place the plugin turns away is never added, and the note says so, so nothing
 * is saved that the plugin would drop on its next read. The id is made once, here.
 *
 * A Pebble app place the read gives no coordinates, such as the current location with no fix, is
 * marked on its row and left out of the count, since a run skips it until it has a fix.
 *
 * Clay writes this into the page as text and runs it there, so it reaches nothing outside itself: no
 * imports but its types, which compile away, and no module-scope constants. The message, the row ids,
 * the caps, and the decimals ride in on the list's text row's `moduleOptions`, and that row is found as
 * the one carrying them.
 */

import type { ClayPage, PluginPageBridge } from '../../paf/ts/plugin-app/page-types';

/** What the list's text row hands the page code. */
export interface PlacesOptions {
  /** The plugin's places message. */
  placesMessage: string;
  /** The hidden row the list is saved in. */
  listKey: string;
  /** The Pebble App Places switch. */
  useAppKey: string;
  /** The hidden row that carries a saved Places to Fetch until the list holds a Pebble app place. */
  oldPlacesKey: string;
  /** The most places watchfaces get. */
  most: number;
  /** The most places the wearer can add. */
  mostAdded: number;
  /** What an added place's id starts with. */
  addedPrefix: string;
  /** The longest name an added place keeps. */
  nameMax: number;
  /** The plugin's message that checks a place before it is added. */
  addMessage: string;
  /** The location search row Add a Place searches with. */
  searchId: string;
  /** The Name row. */
  nameId: string;
  /** The Add button. */
  addId: string;
  /** The text row Add a Place reports in. */
  addNoteId: string;
}

/** One place on the list. */
interface Place {
  id: string;
  name: string;
  current: boolean;
  on: boolean;
  added: boolean;
  lat?: number;
  lon?: number;
  /** A Pebble app place this read did not have, kept in the list with no row. */
  unread: boolean;
  /** Whether a run can fetch it now. A Pebble app place with no coordinates, such as the current location with no fix, cannot. */
  located: boolean;
}

/** The page code Clay runs with the page as `this`. */
export default function placesPage(this: ClayPage): void {
  this.on(this.EVENTS.AFTER_BUILD, () => {
    const holder = this.getAllItems().find((item) => Boolean(item.config && item.config.moduleOptions && typeof (item.config.moduleOptions as Partial<PlacesOptions>).placesMessage === 'string'));
    const options = holder && (holder.config.moduleOptions as PlacesOptions);
    const store = options && this.getItemByMessageKey(options.listKey);

    if (!holder || !options || !store) {
      return;
    }

    const useApp = this.getItemByMessageKey(options.useAppKey);
    const oldPlaces = this.getItemByMessageKey(options.oldPlacesKey);
    const search = this.getItemById(options.searchId);
    const nameRow = this.getItemById(options.nameId);
    const addButton = this.getItemById(options.addId);
    const addNote = this.getItemById(options.addNoteId);
    const bridge = (window as unknown as { Pebble?: PluginPageBridge }).Pebble;
    let places: Place[] | null = null;
    let readError = false;
    // what this last wrote to the row, which tells its own writes from the framework's load
    let written = '';

    store.hide();

    if (oldPlaces) {
      oldPlaces.hide();
    }

    // Clay's base sheet gives every button a 12rem minimum width and an auto margin, which pushes the
    // rows past the screen. each rule here outweighs Clay's by a class, so it wins whichever sheet
    // comes first, as it has to on the Pebble Android app, which puts styles added at runtime ahead of
    // Clay's base sheet. the switches borrow Clay's own toggle look from the component-toggle class
    const style = document.createElement('style');

    style.textContent = [
      '.we-places ul { list-style: none; padding: 0; margin: 0.6rem 0 0; }',
      '.we-places li { padding: 0.2rem 0; border-bottom: 1px solid rgba(128,128,128,.25); display: flex; align-items: center; gap: 0.4rem; min-width: 0; }',
      '.we-places .we-move { flex: 0 0 auto; display: flex; flex-direction: column; }',
      '.we-places .we-name { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }',
      '.we-places .we-tag { flex: 0 0 auto; font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 0.3rem; background: rgba(128,128,128,.25); white-space: nowrap; }',
      '.we-places li button { flex: 0 0 auto; box-sizing: border-box; min-width: 44px; width: 44px; height: 44px; margin: 0; padding: 0; background: transparent; border: 0; color: inherit; opacity: .6; font-size: 1.1rem; line-height: 44px; text-align: center; text-transform: none; letter-spacing: normal; }',
      '.we-places li button:disabled { opacity: .2; }',
      '.we-places li .we-switch { flex: 0 0 auto; padding: 0 0 0 0.4rem; }',
      '.we-places .we-count, .we-places .we-status { font-size: 0.875rem; line-height: 1.3rem; color: #a4a4a4; margin: 0.6rem 0 0; }',
      '.we-places .we-warn { color: #ff6b00; }',
    ].join('\n');
    document.head.appendChild(style);

    const make = (tag: string, className: string, text?: string): HTMLElement => {
      const element = document.createElement(tag);

      element.className = className;

      if (text !== undefined) {
        element.textContent = text;
      }

      return element;
    };

    const box = make('div', 'we-places');
    const status = make('p', 'we-status');
    const list = make('ul', 'component-toggle');
    const count = make('p', 'we-count');

    box.appendChild(status);
    box.appendChild(list);
    box.appendChild(count);
    holder.$element[0].appendChild(box);

    const say = (line: HTMLElement, base: string, text: string, warn: boolean): void => {
      line.textContent = text;
      line.className = warn ? base + ' we-warn' : base;
    };

    // a name the wearer typed goes in as text, never as markup
    const note = (text: string): void => {
      const line = addNote && addNote.$element[0].querySelector('p');

      if (line) {
        line.textContent = text;
      }
    };

    const appOn = (): boolean => !useApp || useApp.get() !== false;

    // the Pebble app's rows hide while Pebble App Places is off, and an unread one never has a row
    const shownPlaces = (): Place[] => (places || []).filter((place) => !place.unread && (place.added || appOn()));

    // a list holding a Pebble app place carries First Location Only itself, so the PLACES row is emptied
    const dropOldPlaces = (): void => {
      if (oldPlaces && (places || []).some((place) => !place.added) && String(oldPlaces.get() || '') !== '') {
        oldPlaces.set('');
      }
    };

    const write = (): void => {
      written = JSON.stringify((places || []).map((place) => (place.added ? { id: place.id, on: place.on, name: place.name, lat: place.lat, lon: place.lon } : { id: place.id, app: true, on: place.on })));
      store.set(written);
      dropOldPlaces();
    };

    // a place with no fix right now is skipped by the run, so it does not count toward the top places
    const tally = (): void => {
      const switchedOn = shownPlaces().filter((place) => place.on);
      const on = switchedOn.filter((place) => place.located).length;

      if (on === 0 && switchedOn.length > 0) {
        say(count, 'we-count', 'No place that is on has a fix right now, so watchfaces get no weather from Weather Enhanced until one does.', true);
      } else if (on === 0) {
        say(count, 'we-count', 'No place is on, so watchfaces get no weather from Weather Enhanced.', true);
      } else if (on > options.most) {
        say(count, 'we-count', on + ' places on. Watchfaces get only the top ' + options.most + '.', true);
      } else {
        say(count, 'we-count', on === 1 ? '1 place on.' : on + ' places on.', false);
      }
    };

    const showStatus = (): void => {
      const appShown = (places || []).some((place) => !place.added && !place.unread);

      if (!appOn() || !places) {
        status.style.display = 'none';
        return;
      }

      status.style.display = '';

      if (readError) {
        say(status, 'we-status', "Could not read the Pebble app's weather list, so its places stay as they were saved. Check that Weather Enhanced is allowed Location.", true);
      } else if (!appShown) {
        say(status, 'we-status', "The Pebble app's weather list has no places yet. Add them in the Pebble app, or add a place below.", true);
      } else {
        status.style.display = 'none';
      }
    };

    // adding waits for the plugin's answer, since a list written before it would replace the saved one
    const fitAdding = (): void => {
      const added = (places || []).filter((place) => place.added).length;
      const open = places !== null && added < options.mostAdded;

      // the location search has no show or hide of its own, so each row is hidden by its element
      [search, nameRow, addButton].forEach((row) => {
        if (row) {
          row.$element[0].style.display = open ? '' : 'none';
        }
      });

      if (places !== null && !open) {
        note(options.mostAdded + ' places added, the most there can be. Remove one to add another.');
      }
    };

    const button = (text: string, label: string, onTap: () => void, enabled: boolean): HTMLButtonElement => {
      const tap = make('button', '', text) as HTMLButtonElement;

      tap.type = 'button';
      tap.setAttribute('aria-label', label);
      tap.disabled = !enabled;
      tap.onclick = onTap;

      return tap;
    };

    const draw = (): void => {
      const all = places || [];
      const shown = shownPlaces();

      list.textContent = '';
      shown.forEach((place, index) => {
        const row = document.createElement('li');
        const name = place.name || (place.current ? 'Current Location' : 'Unnamed Place');
        // a move swaps with the next row shown, so a hidden place keeps its place among the rest
        const move = (by: number) => () => {
          const next = shown[index + by];

          all.splice(all.indexOf(place), 1);
          all.splice(all.indexOf(next) + (by > 0 ? 1 : 0), 0, place);
          write();
          draw();
        };
        const reorder = make('span', 'we-move');
        const toggle = make('label', 'we-switch');
        const input = document.createElement('input');
        const graphic = make('span', 'graphic');

        // a disabled arrow keeps its place so the rows line up
        reorder.appendChild(button('↑', 'Move ' + name + ' up', move(-1), index > 0));
        reorder.appendChild(button('↓', 'Move ' + name + ' down', move(1), index < shown.length - 1));
        row.appendChild(reorder);
        row.appendChild(make('span', 'we-name', name));

        // the tag tells the current location apart when the Pebble app gives it a city's name
        if (place.added) {
          row.appendChild(make('span', 'we-tag', 'Added Here'));
        } else if (!place.located) {
          row.appendChild(make('span', 'we-tag', 'No Fix Right Now'));
        } else if (place.current && place.name) {
          row.appendChild(make('span', 'we-tag', 'Current Location'));
        }

        if (place.added) {
          row.appendChild(button('✕', 'Remove ' + name, () => {
            all.splice(all.indexOf(place), 1);
            write();
            draw();
            note('Removed ' + name + '.');
          }, true));
        }

        input.type = 'checkbox';
        input.checked = place.on;
        input.setAttribute('aria-label', 'Show ' + name + ' on watchfaces');

        input.onchange = () => {
          place.on = input.checked;
          write();
          tally();
        };

        graphic.appendChild(make('span', 'slide'));
        graphic.appendChild(make('span', 'marker'));
        toggle.appendChild(input);
        toggle.appendChild(graphic);
        row.appendChild(toggle);
        list.appendChild(row);
      });
      tally();
      showStatus();
      fitAdding();
    };

    /** The pick the search holds, or null while it holds none with coordinates. */
    const pickOf = (): { label: string; lat: number; lon: number } | null => {
      let pick: { label?: unknown; lat?: unknown; lon?: unknown } | null;

      try {
        pick = search ? JSON.parse(String(search.get() || 'null')) : null;
      } catch (error) {
        return null;
      }

      // the plugin checks the range when the place is added, so the page only needs two numbers
      const finite = (value: unknown): value is number => typeof value === 'number' && isFinite(value);

      return pick && finite(pick.lat) && finite(pick.lon) ? { label: typeof pick.label === 'string' ? pick.label : '', lat: pick.lat, lon: pick.lon } : null;
    };

    // the geocoder labels a pick with its region and country, and the town alone reads best on a watch
    const shortName = (label: string): string => label.split(',')[0].trim();

    // six letters after the prefix every time. a random number can write out short in base 36, so
    // letters are added until there are enough
    const newId = (): string => {
      let id = '';

      while (!id || (places || []).some((place) => place.id === id)) {
        let letters = '';

        while (letters.length < 6) {
          letters += Math.random().toString(36).slice(2);
        }

        id = options.addedPrefix + letters.slice(0, 6);
      }

      return id;
    };

    if (search) {
      search.on('change', () => {
        const pick = pickOf();

        if (pick && nameRow) {
          nameRow.set(shortName(pick.label).slice(0, options.nameMax));
        }
      });
    }

    // one add at a time, so a second tap before the plugin answers cannot add the place twice
    let adding = false;

    const refuseAdd = (): void => note('Weather Enhanced could not add that place. Pick it from the search list again.');

    if (addButton) {
      addButton.on('click', () => {
        const pick = pickOf();
        const typed = nameRow ? String(nameRow.get() || '').trim() : '';
        const name = (typed || (pick ? shortName(pick.label) : '')).slice(0, options.nameMax);

        if (!places || !bridge || adding) {
          return;
        }

        if (!pick) {
          note('Pick a place from the search list first.');
          return;
        }

        if (!name) {
          note('Give the place a name.');
          return;
        }

        adding = true;

        bridge.sendMessage('plugin', { type: options.addMessage, place: { id: newId(), on: true, name, lat: pick.lat, lon: pick.lon } }).then((reply) => {
          const entry = reply && typeof reply === 'object' ? (reply as { entry?: { id?: unknown; on?: unknown; name?: unknown; lat?: unknown; lon?: unknown } | null }).entry : null;

          adding = false;

          if (!places || !entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.lat !== 'number' || typeof entry.lon !== 'number') {
            refuseAdd();
            return;
          }

          places.push({ id: entry.id, name: entry.name, current: false, on: entry.on !== false, added: true, lat: entry.lat, lon: entry.lon, unread: false, located: true });
          write();
          draw();

          if (search) {
            search.set('');
          }

          if (nameRow) {
            nameRow.set('');
          }

          if (places.filter((place) => place.added).length < options.mostAdded) {
            note('Added ' + entry.name + '. Save to send it to watchfaces.');
          }
        }).catch(() => {
          adding = false;
          refuseAdd();
        });
      });
    }

    if (useApp) {
      useApp.on('change', () => {
        if (places) {
          draw();
        }
      });
    }

    // the framework sets the row from the saved settings once they load, which can land after the
    // plugin's answer. the answer was laid out from those same settings, so it goes back over them
    store.on('change', () => {
      if (places && String(store.get()) !== written) {
        write();
      }
    });

    // the framework's load can set the PLACES row after the answer emptied it, so it is emptied again
    if (oldPlaces) {
      oldPlaces.on('change', dropOldPlaces);
    }

    fitAdding();

    if (!bridge || typeof bridge.sendMessage !== 'function' || typeof bridge.addEventListener !== 'function') {
      say(count, 'we-count', 'Open this page from the Pebble app to change the places.', false);
      return;
    }

    say(count, 'we-count', 'Reading the place list...', false);

    bridge.addEventListener('ready', (event) => {
      if (event.target !== 'plugin') {
        return;
      }

      bridge.sendMessage('plugin', { type: options.placesMessage }).then((reply) => {
        const answer = reply && typeof reply === 'object' ? (reply as { places?: unknown; error?: unknown }) : {};

        if (!Array.isArray(answer.places)) {
          say(count, 'we-count', 'Could not read the place list, so your places stay as they were saved.', true);
          return;
        }

        places = answer.places.filter((place) => place && typeof place === 'object' && typeof place.id === 'string' && place.id).map((place): Place => ({
          id: place.id,
          name: typeof place.name === 'string' ? place.name : '',
          current: place.current === true,
          on: place.on !== false,
          added: place.added === true,
          lat: typeof place.lat === 'number' ? place.lat : undefined,
          lon: typeof place.lon === 'number' ? place.lon : undefined,
          unread: place.unread === true,
          located: place.added === true || place.located !== false,
        }));
        readError = typeof answer.error === 'string' && answer.error !== '';
        write();
        draw();
      }).catch(() => say(count, 'we-count', 'Could not read the place list, so your places stay as they were saved.', true));
    });
  });
}
