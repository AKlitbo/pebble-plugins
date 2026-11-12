/**
 * The page code on Weather Enhanced's settings page, which shows the Pebble app's own units beside
 * Pebble App on the unit rows, such as Pebble App (°C).
 *
 * The page cannot read the Pebble app's units itself, so once the plugin says it is ready, this asks
 * it. Only the words on the page change. Pebble App still saves as `app`, so the plugin follows the
 * Pebble app if the wearer changes it later. An ask that fails, is refused, or never answers leaves
 * the rows reading Pebble App, and nothing on the page waits on it.
 *
 * Clay writes this into the page as text and runs it there, so it reaches nothing outside itself: no
 * imports and no module-scope constants. The message and the row names ride in on the Units text
 * row's `moduleOptions`.
 */

/** The bits of a Clay row this reaches. */
interface PageRow {
  config: { moduleOptions?: UnitsOptions };
  $element: HTMLElement[];
  get(): unknown;
}

/** The bits of the Clay config page this reaches. */
interface ClayPage {
  EVENTS: { AFTER_BUILD: string };
  on(event: string, handler: () => void): void;
  getItemById(id: string): PageRow | undefined;
  getItemByMessageKey(messageKey: string): PageRow | undefined;
}

/** The page's bridge to the plugin, as the Pebble app gives a settings page. */
interface PageBridge {
  addEventListener(name: string, listener: (event: { target: string }) => void): void;
  sendMessage(target: string, message: unknown): Promise<unknown>;
}

/** What the Units text row hands the page code. */
export interface UnitsOptions {
  /** The plugin's units message. */
  unitsMessage: string;
  /** Each unit row's message key, against the name its unit has in the plugin's answer. */
  rows: Record<string, string>;
  /** The value Pebble App saves as. */
  appValue: string;
  /** The words Pebble App shows as. */
  appLabel: string;
}

/** The page code Clay runs with the page as `this`. */
export default function weatherPage(this: ClayPage): void {
  this.on(this.EVENTS.AFTER_BUILD, () => {
    const holder = this.getItemById('we-units');
    const options = holder && holder.config.moduleOptions;
    const bridge = (window as unknown as { Pebble?: PageBridge }).Pebble;

    if (!options || !bridge || typeof bridge.sendMessage !== 'function' || typeof bridge.addEventListener !== 'function') {
      return;
    }

    const show = (units: Record<string, unknown>) => {
      Object.keys(options.rows).forEach((messageKey) => {
        const unit = units[options.rows[messageKey]];
        const row = this.getItemByMessageKey(messageKey);
        const element = row && row.$element[0];

        // a unit is a few characters, such as °C or km/h, so anything else is not shown
        if (typeof unit !== 'string' || !unit || unit.length > 8 || !row || !element) {
          return;
        }

        const label = options.appLabel + ' (' + unit + ')';
        const option = Array.prototype.find.call(element.querySelectorAll('option'), (each: HTMLOptionElement) => each.value === options.appValue) as HTMLOptionElement | undefined;
        const shown = element.querySelector('.value');

        if (option) {
          option.textContent = label;
        }

        // Clay writes the picked option's words beside the label only when the pick changes, so the one showing now is set here
        if (shown && row.get() === options.appValue) {
          shown.textContent = label;
        }
      });
    };

    bridge.addEventListener('ready', (event) => {
      if (event.target !== 'plugin') {
        return;
      }

      bridge.sendMessage('plugin', { type: options.unitsMessage }).then((reply) => {
        const units = reply && typeof reply === 'object' ? (reply as { units?: unknown }).units : undefined;

        if (units && typeof units === 'object') {
          show(units as Record<string, unknown>);
        }
      }).catch(() => undefined);
    });
  });
}
