/**
 * The page code on Calendar Enhanced + iCal's settings page that lists the phone's calendars, each with
 * a switch, so a calendar switched off stays off the wearer's watchfaces.
 *
 * The page cannot read the phone's calendars itself, so once the plugin says it is ready, this asks it.
 * The plugin answers with the calendars that have events in the built-in's week, and the names the
 * saved settings switch off, read from the same settings the page loads. The names switched off live in
 * the framework's hidden store as a JSON list, so the framework loads and saves them with the rest.
 *
 * A switch only adds or takes away its own name. A calendar switched off that has no events this week
 * still gets a row, switched off and marked as having none, so the wearer can turn it back on, and it
 * is still off when it comes back otherwise. Nothing is written until the wearer flips a switch, so a
 * save with the list untouched keeps what was saved. An ask that fails, answers an error, or never
 * answers leaves the store as it loaded and shows no switches. A refused read says Calendar is not
 * allowed, apart from a week with no events.
 *
 * Clay writes this into the page as text and runs it there, so it reaches nothing outside itself: no
 * imports but its types, which compile away, and no module-scope constants. The message and the store's
 * key ride in on the list row's `moduleOptions`.
 */

import type { ClayPage, PluginPageBridge } from '../../paf/ts/plugin-app/page-types';

/** What the list row hands the page code. */
export interface CalendarsOptions {
  /** The plugin's calendars message. */
  calendarsMessage: string;
  /** The hidden store's message key, which holds the names switched off. */
  storeKey: string;
}

/** The page code Clay runs with the page as `this`. */
export default function calendarsPage(this: ClayPage): void {
  this.on(this.EVENTS.AFTER_BUILD, () => {
    const holder = this.getItemById('cei-calendars');
    const options = holder && (holder.config.moduleOptions as CalendarsOptions | undefined);
    const store = options && this.getItemByMessageKey(options.storeKey);
    const bridge = (window as unknown as { Pebble?: PluginPageBridge }).Pebble;

    if (!holder || !options || !store || !bridge || typeof bridge.sendMessage !== 'function' || typeof bridge.addEventListener !== 'function') {
      return;
    }

    let hidden: string[] = [];
    // what this last wrote to the store, which tells its own writes from the framework's load
    let written: string | null = null;

    const make = (tag: string, className: string, text?: string): HTMLElement => {
      const element = document.createElement(tag);

      element.className = className;

      if (text !== undefined) {
        element.textContent = text;
      }

      return element;
    };

    // the switches borrow Clay's own toggle look from the component-toggle class
    const style = document.createElement('style');

    style.textContent = [
      '.cei-calendars ul { list-style: none; padding: 0; margin: 0.6rem 0 0; }',
      '.cei-calendars li { padding: 0.2rem 0; border-bottom: 1px solid rgba(128,128,128,.25); display: flex; align-items: center; gap: 0.4rem; min-width: 0; }',
      '.cei-calendars .cei-name { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }',
      '.cei-calendars li .cei-switch { flex: 0 0 auto; padding: 0 0 0 0.4rem; }',
      '.cei-calendars .cei-note { font-size: 0.875rem; line-height: 1.3rem; color: #a4a4a4; margin: 0.6rem 0 0; }',
      '.cei-calendars .cei-tag { flex: 0 0 auto; font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 0.3rem; background: rgba(128,128,128,.25); white-space: nowrap; }',
    ].join('\n');
    document.head.appendChild(style);

    const box = make('div', 'cei-calendars');
    const list = make('ul', 'component-toggle');
    const note = make('p', 'cei-note');

    box.appendChild(list);
    box.appendChild(note);
    holder.$element[0].appendChild(box);

    const write = (): void => {
      written = hidden.length > 0 ? JSON.stringify(hidden.slice().sort()) : '';
      store.set(written);
    };

    // a name the phone gave goes in as text, never as markup
    const draw = (calendars: string[]): void => {
      // a calendar switched off with no events this week gets a row too, so it can be turned back on
      const quiet = hidden.filter((name) => calendars.indexOf(name) === -1).sort();

      list.textContent = '';
      note.textContent = calendars.length > 0 || quiet.length > 0 ? '' : 'No phone calendar has events in the next 7 days.';

      calendars.concat(quiet).forEach((name) => {
        const row = document.createElement('li');
        const toggle = make('label', 'cei-switch');
        const input = document.createElement('input');
        const graphic = make('span', 'graphic');

        input.type = 'checkbox';
        input.checked = hidden.indexOf(name) === -1;
        input.setAttribute('aria-label', 'Show ' + name + ' on watchfaces');

        input.onchange = () => {
          hidden = hidden.filter((each) => each !== name);

          if (!input.checked) {
            hidden.push(name);
          }

          write();
        };

        graphic.appendChild(make('span', 'slide'));
        graphic.appendChild(make('span', 'marker'));
        toggle.appendChild(input);
        toggle.appendChild(graphic);
        row.appendChild(make('span', 'cei-name', name));

        if (quiet.indexOf(name) !== -1) {
          row.appendChild(make('span', 'cei-tag', 'No Events This Week'));
        }

        row.appendChild(toggle);
        list.appendChild(row);
      });
    };

    // the framework sets the store from the saved settings once they load, which can land after a
    // switch was flipped. the answer came from those same settings, so the wearer's flips go back over them
    store.on('change', () => {
      if (written !== null && String(store.get()) !== written) {
        write();
      }
    });

    bridge.addEventListener('ready', (event) => {
      if (event.target !== 'plugin') {
        return;
      }

      bridge.sendMessage('plugin', { type: options.calendarsMessage }).then((reply) => {
        const answer = reply && typeof reply === 'object' ? (reply as { calendars?: unknown; hidden?: unknown; error?: unknown }) : {};

        if (answer.error === 'PERMISSION_DENIED') {
          note.textContent = "The Pebble app hasn't allowed Calendar Enhanced + iCal to read your phone's calendars, so the ones switched off stay as they were saved.";
          return;
        }

        if (answer.error || !Array.isArray(answer.calendars)) {
          note.textContent = "Couldn't read your phone's calendars, so the ones switched off stay as they were saved.";
          return;
        }

        hidden = Array.isArray(answer.hidden) ? answer.hidden.filter((name): name is string => typeof name === 'string') : [];
        draw(answer.calendars.filter((name): name is string => typeof name === 'string' && name.length > 0));
      }).catch(() => undefined);
    });
  });
}
