// @vitest-environment jsdom
/**
 * Specs for the page code that shows the Pebble app's units on the unit rows, run against a stand-in
 * for the Clay page and the plugin's real answers to the page.
 *
 * What is pinned is what the wearer reads: Pebble App with the Pebble app's own unit once the plugin
 * answers, and Pebble App alone when it cannot, never a unit the Pebble app is not set to.
 */

import { describe, test, expect } from 'vitest';
import type { ClayConfigItem } from '../../paf/ts/clay/types';
import type { SourceEnvelope } from '../../paf/ts/plugin-sources/types';
import { IMPERIAL_UNITS, bridgeWith } from '../plugin/testing/fake-bridge';
import { clayConfig } from './index';
import weatherPage from './weather-page';
import type { UnitsOptions } from './weather-page';

/** Every row on the page, sections opened up. */
function rows(items: ClayConfigItem[]): ClayConfigItem[] {
  return items.flatMap((item) => (item.items ? rows(item.items) : [item]));
}

/** A unit row drawn the way Clay draws a select, showing the picked option's words beside its label. */
function selectRow(messageKey: string, picked: string) {
  const config = rows(clayConfig).find((item) => item.messageKey === messageKey) as ClayConfigItem;
  const element = document.createElement('div');
  const label = document.createElement('label');
  const shown = document.createElement('span');
  const select = document.createElement('select');

  shown.className = 'value';
  (config.options || []).forEach((option) => {
    const each = document.createElement('option');

    each.value = String(option.value);
    each.textContent = option.label;
    select.appendChild(each);
  });
  select.value = picked;
  shown.textContent = select.selectedOptions[0].textContent;
  label.append(shown, select);
  element.appendChild(label);
  document.body.appendChild(element);

  return { config: {}, $element: [element], get: () => picked };
}

/**
 * Opens the page code with these picks on the unit rows, and the plugin answering the units read the
 * way given. The plugin's answer can be held back for good, as one that never comes.
 */
async function openPage(picks: Record<string, string>, readUnits: () => Promise<SourceEnvelope>, answers = true) {
  document.body.innerHTML = '';

  const holder = rows(clayConfig).find((item) => item.id === 'we-units') as ClayConfigItem;
  const unitRows: Record<string, ReturnType<typeof selectRow>> = {};

  Object.keys(picks).forEach((key) => (unitRows[key] = selectRow(key, picks[key])));

  const ask = bridgeWith(readUnits);
  let built: () => void = () => undefined;
  let ready: (event: { target: string }) => void = () => undefined;
  const page = {
    EVENTS: { AFTER_BUILD: 'after-build' },
    on: (_event: string, run: () => void) => void (built = run),
    getItemById: (id: string) => (id === 'we-units' ? { config: { moduleOptions: holder.moduleOptions as UnitsOptions }, $element: [], get: () => '' } : undefined),
    getItemByMessageKey: (key: string) => unitRows[key],
  };

  (window as unknown as { Pebble: unknown }).Pebble = {
    addEventListener: (name: string, listener: typeof ready) => void (name === 'ready' ? (ready = listener) : undefined),
    sendMessage: (_target: string, message: unknown) => (answers ? ask(message) : new Promise(() => undefined)),
  };

  weatherPage.call(page);
  built();
  ready({ target: 'plugin' });

  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }

  return (key: string) => {
    const element = unitRows[key].$element[0];
    const option = Array.from(element.querySelectorAll('option')).find((each) => each.value === 'app') as HTMLOptionElement;

    return [option.textContent, (element.querySelector('.value') as HTMLElement).textContent];
  };
}

const ALL_APP = { TEMPERATURE_UNIT: 'app', WIND_UNIT: 'app', PRESSURE_UNIT: 'app' };

describe('the unit rows', () => {
  /** Pebble App alone does not say what the wearer gets, so the row names the Pebble app's own unit. */
  test("show the Pebble app's units beside Pebble App once the plugin answers", async () => {
    const shown = await openPage(ALL_APP, async () => IMPERIAL_UNITS);

    const result = ['TEMPERATURE_UNIT', 'WIND_UNIT', 'PRESSURE_UNIT'].map(shown);

    expect(result).toEqual([
      ['Pebble App (°F)', 'Pebble App (°F)'],
      ['Pebble App (mph)', 'Pebble App (mph)'],
      ['Pebble App (inHg)', 'Pebble App (inHg)'],
    ]);
  });

  /** A unit shown from a read the Pebble app refused would be a guess, so the row says Pebble App and nothing more. */
  test('stay Pebble App when the read is refused', async () => {
    const shown = await openPage(ALL_APP, () => Promise.reject(new Error('PERMISSION_DENIED')));

    const result = shown('TEMPERATURE_UNIT');

    expect(result).toEqual(['Pebble App', 'Pebble App']);
  });

  /** The runtime can leave the ask unanswered, and the rows have to read as they would with no plugin at all. */
  test('stay Pebble App while the plugin never answers', async () => {
    const shown = await openPage(ALL_APP, async () => IMPERIAL_UNITS, false);

    const result = shown('TEMPERATURE_UNIT');

    expect(result).toEqual(['Pebble App', 'Pebble App']);
  });

  /** A row the wearer moved off Pebble App has to keep showing their own pick, with the Pebble app's unit only in the list. */
  test('keep showing an override while naming the Pebble app unit in the list', async () => {
    const shown = await openPage({ ...ALL_APP, TEMPERATURE_UNIT: '°C' }, async () => IMPERIAL_UNITS);

    const result = shown('TEMPERATURE_UNIT');

    expect(result).toEqual(['Pebble App (°F)', 'Celsius (°C)']);
  });
});
