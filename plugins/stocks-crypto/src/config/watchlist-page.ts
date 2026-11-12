/**
 * The watchlist on Stocks + Crypto's settings page, drawn the way Pebble's own Stocks plugin draws
 * its list: an input with its Add buttons, a hint card, and one row per ticker with its name and an ×.
 *
 * The list lives in the page's hidden `WATCHLIST` row as JSON, so the framework loads and saves it with
 * the other settings. Adding a ticker asks the plugin, which checks what a ticker is, refuses one already
 * on the list, and holds each kind to its cap, so those rules are written once, beside the code that
 * reads the list. Moving and dropping a ticker happen here, since neither can make the list wrong.
 *
 * Clay writes this into the page as text and runs it there, so it reaches nothing outside itself: no
 * imports and no module-scope constants. The caps and the words it needs ride in on the container row's
 * `moduleOptions`.
 */

/** The bits of a Clay row this reaches. */
interface PageRow {
  config: { moduleOptions?: WatchlistOptions };
  $element: HTMLElement[];
  get(): unknown;
  set(value: unknown): void;
  hide(): void;
  on(event: string, handler: () => void): void;
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

/** What the container row hands the page code. */
export interface WatchlistOptions {
  /** The list a page with nothing saved opens on. */
  defaultList: Array<{ ticker: string; kind: string }>;
  /** The most stocks Alpha Vantage's free key prices. */
  alphaVantageCap: number;
  /** The most tickers of each kind the list takes. */
  perKind: number;
  /** The plugin's add and names messages. */
  addMessage: string;
  namesMessage: string;
  /** The framework's callout box and its warning badge, each the body of one CSS rule. */
  calloutBox: string;
  calloutBadge: string;
}

/** The page code Clay runs with the page as `this`. */
export default function watchlistPage(this: ClayPage): void {
  this.on(this.EVENTS.AFTER_BUILD, () => {
    const holder = this.getItemById('sc-watchlist');
    const store = this.getItemByMessageKey('WATCHLIST');
    const provider = this.getItemByMessageKey('PROVIDER');
    const paid = this.getItemByMessageKey('ALPHAVANTAGE_PAID');

    if (!holder || !store || !holder.config.moduleOptions) {
      return;
    }

    const options = holder.config.moduleOptions;
    const bridge = (window as unknown as { Pebble?: PageBridge }).Pebble;
    const names: Record<string, string> = {};

    store.hide();

    // Clay's base sheet gives every button a 12rem minimum width and an auto margin, which pushes the
    // rows and the Add buttons past the screen. each rule here outweighs Clay's by a class, so it wins
    // whichever sheet comes first, as it has to on the Pebble Android app, which puts styles added at
    // runtime ahead of Clay's base sheet
    const style = document.createElement('style');

    style.textContent = [
      '.sc-list-box { padding-top: 0.2rem; max-width: 100%; }',
      '.component-text .sc-footer { text-align: center; }',
      '.sc-list-box .sc-hint { font-size: 0.85rem; line-height: 1.3rem; color: #a4a4a4; margin: 0 0 0.6rem; }',
      '.sc-list-box .sc-add { display: flex; margin-bottom: 0.5rem; }',
      '.sc-list-box .sc-add input { flex: 1 1 auto; width: 100%; min-width: 0; box-sizing: border-box; padding: 0.6rem 0.75rem; font-size: 0.95rem; border-radius: 0.5rem; border: 1px solid rgba(128,128,128,.5); background: transparent; color: inherit; }',
      '.sc-list-box .sc-buttons { display: flex; gap: 0.5rem; margin-bottom: 0.6rem; }',
      '.sc-list-box .sc-buttons button { flex: 1 1 0; min-width: 0; width: auto; margin: 0; padding: 0.6rem 0.5rem; font-size: 0.95rem; line-height: 1.4rem; border-radius: 0.5rem; border: 0; background: #ff6b00; color: #fff; text-transform: none; letter-spacing: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.sc-list-box .pf-note { ' + options.calloutBox + ' margin: 0 0 0.6rem; }',
      '.sc-list-box .pf-note-warning:before { ' + options.calloutBadge + ' }',
      '.sc-list-box .sc-status { padding: 0.6rem 0.75rem; border-radius: 0.5rem; background: rgba(128,128,128,.15); font-size: 0.875rem; min-height: 1.25rem; }',
      '.sc-list-box ul { list-style: none; padding: 0; margin: 0.75rem 0 0; }',
      '.sc-list-box li { padding: 0.2rem 0; border-bottom: 1px solid rgba(128,128,128,.25); display: flex; align-items: center; gap: 0.4rem; min-width: 0; }',
      '.sc-list-box .sc-move { flex: 0 0 auto; display: flex; flex-direction: column; }',
      '.sc-list-box .sc-symbol { flex: 0 0 auto; font-weight: 700; white-space: nowrap; }',
      '.sc-list-box .sc-name { flex: 1 1 auto; min-width: 0; opacity: .7; font-size: 0.875rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }',
      '.sc-list-box .sc-tag { flex: 0 0 auto; font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 0.3rem; background: rgba(128,128,128,.25); white-space: nowrap; }',
      '.sc-list-box .sc-tag.sc-crypto { background: rgba(255,107,0,.25); }',
      '.sc-list-box li button { flex: 0 0 auto; box-sizing: border-box; min-width: 44px; width: 44px; height: 44px; margin: 0; padding: 0; background: transparent; border: 0; color: inherit; opacity: .6; font-size: 1.1rem; line-height: 44px; text-align: center; text-transform: none; letter-spacing: normal; }',
      '.sc-list-box li button:disabled { opacity: .2; }',
      '.sc-list-box .sc-note { font-size: 0.85rem; line-height: 1.3rem; color: #ff6b00; margin: 0.6rem 0 0; }',
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

    const box = make('div', 'sc-list-box');
    const addRow = make('div', 'sc-add');
    const input = document.createElement('input');
    const buttons = make('div', 'sc-buttons');
    const addStock = make('button', '', 'Add Stock') as HTMLButtonElement;
    const addCrypto = make('button', '', 'Add Crypto') as HTMLButtonElement;
    const status = make('div', 'sc-status');
    const list = document.createElement('ul');
    const note = make('p', 'sc-note');
    // the warning callout the framework draws its location notes in, where crypto is added
    const cryptoNote = make('div', 'pf-note pf-note-warning');

    cryptoNote.appendChild(make('span', 'pf-note-text', 'Crypto prices always come from Yahoo, whatever the Data Source. Spell each pair the way Yahoo does, such as BTC-USD.'));

    input.placeholder = 'GOOG or BTC-USD';
    input.setAttribute('autocapitalize', 'characters');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('enterkeyhint', 'done');
    // the page sits in Clay's form, and the framework saves and closes the page on its submit. naming a
    // form that does not exist leaves the box with no form, so Enter, or Go on an Android keyboard,
    // cannot submit the page
    input.setAttribute('form', 'sc-no-form');
    addStock.type = 'button';
    addCrypto.type = 'button';
    addRow.appendChild(input);
    buttons.appendChild(addStock);
    buttons.appendChild(addCrypto);
    box.appendChild(make('p', 'sc-hint', 'A watchface may show only its first few tickers, so put the ones you want on your watch first.'));
    box.appendChild(addRow);
    box.appendChild(buttons);
    box.appendChild(cryptoNote);
    box.appendChild(status);
    box.appendChild(list);
    box.appendChild(note);
    holder.$element[0].appendChild(box);

    const say = (text: string): void => {
      status.textContent = text;
    };

    // a value that does not read as a list opens on the default, as a page with nothing saved does
    const read = (): Array<{ ticker: string; kind: string }> => {
      try {
        const saved = JSON.parse(String(store.get() || ''));

        return Array.isArray(saved) ? saved : options.defaultList;
      } catch {
        return options.defaultList;
      }
    };

    const write = (entries: Array<{ ticker: string; kind: string }>): void => {
      store.set(JSON.stringify(entries));
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
      const entries = read();
      const stocks = entries.filter((entry) => entry.kind !== 'crypto').length;
      const picked = provider ? String(provider.get()) : '';
      const free = !(paid && paid.get() === true);

      list.textContent = '';
      entries.forEach((entry, index) => {
        const row = document.createElement('li');
        const crypto = entry.kind === 'crypto';
        const move = (by: number) => () => {
          const moved = entries.slice();

          moved.splice(index + by, 0, moved.splice(index, 1)[0]);
          write(moved);
        };

        // the arrows stack at the left and the × sits alone at the far right, as on Pebble's own Stocks
        // page, so the whole row lies between moving a ticker and dropping it. a disabled arrow keeps
        // its place so the rows line up
        const reorder = make('span', 'sc-move');

        reorder.appendChild(button('↑', 'Move ' + entry.ticker + ' up', move(-1), index > 0));
        reorder.appendChild(button('↓', 'Move ' + entry.ticker + ' down', move(1), index < entries.length - 1));
        row.appendChild(reorder);
        row.appendChild(make('span', 'sc-symbol', entry.ticker));
        row.appendChild(make('span', 'sc-name', names[entry.ticker] || ''));
        row.appendChild(make('span', crypto ? 'sc-tag sc-crypto' : 'sc-tag', crypto ? 'Crypto' : 'Stock'));
        row.appendChild(button('×', 'Drop ' + entry.ticker, () => write(entries.filter((_other, at) => at !== index)), true));
        list.appendChild(row);
      });

      note.textContent = picked === 'alphavantage' && free && stocks > options.alphaVantageCap
        ? 'A free Alpha Vantage key prices your first ' + options.alphaVantageCap + ' stocks. The ones after show NO ACCESS.'
        : '';
      say(entries.length ? 'Tap × to drop a ticker, and the arrows to move it.' : 'No tickers yet. Add one above.');
    };

    // the tickers asked for and not answered yet. a double tap, or Enter and then Add, asks for the same
    // one twice, and the second answer would only report it as already on the list
    const asking: string[] = [];

    const add = (kind: string) => () => {
      if (!bridge || typeof bridge.sendMessage !== 'function') {
        say('Open this page from the Pebble app to change the list.');
        return;
      }

      const typed = input.value.trim().toUpperCase();

      if (typed && asking.indexOf(typed) !== -1) {
        return;
      }

      asking.push(typed);
      say('Adding ' + typed + '...');

      const done = () => {
        const index = asking.indexOf(typed);

        if (index !== -1) {
          asking.splice(index, 1);
        }
      };

      bridge.sendMessage('plugin', { type: options.addMessage, watchlist: JSON.stringify(read()), ticker: input.value, kind: kind }).then((reply) => {
        done();

        const answer = (reply || {}) as { error?: string; ticker?: string; kind?: string; names?: Record<string, string> };

        if (answer.error || !answer.ticker || !answer.kind) {
          say(answer.error || 'The plugin did not add it.');
          return;
        }

        // the ticker joins the list as it stands now, so a move, a drop, or another add made while
        // the plugin was answering is kept. one already on it, or past its kind's cap by then, is left off
        const entries = read();
        const added = { ticker: answer.ticker, kind: answer.kind };

        Object.keys(answer.names || {}).forEach((ticker) => (names[ticker] = (answer.names as Record<string, string>)[ticker]));

        if (entries.some((entry) => entry.ticker === added.ticker)) {
          say(added.ticker + ' is already on the list.');
          return;
        }

        if (entries.filter((entry) => entry.kind === added.kind).length >= options.perKind) {
          say('The list takes ' + options.perKind + (added.kind === 'crypto' ? ' crypto tickers' : ' stocks') + '. Drop one to add another.');
          return;
        }

        if (input.value.trim().toUpperCase() === added.ticker) {
          input.value = '';
        }

        write(entries.concat([added]));
      }).catch((error) => {
        done();
        say('Could not add it: ' + error);
      });
    };

    addStock.onclick = add('stock');
    addCrypto.onclick = add('crypto');
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.keyCode === 13) {
        event.preventDefault();
        event.stopPropagation();
        add('stock')();
      }
    });
    store.on('change', draw);

    if (provider) {
      provider.on('change', draw);
    }

    if (paid) {
      paid.on('change', draw);
    }

    if (bridge && typeof bridge.addEventListener === 'function') {
      bridge.addEventListener('ready', (event) => {
        if (event.target !== 'plugin') {
          return;
        }

        bridge.sendMessage('plugin', { type: options.namesMessage }).then((reply) => {
          const known = ((reply || {}) as { names?: Record<string, string> }).names || {};

          Object.keys(known).forEach((ticker) => (names[ticker] = known[ticker]));
          draw();
        }).catch(() => undefined);
      });
    }

    draw();
  });
}
