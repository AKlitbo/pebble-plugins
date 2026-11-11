/**
 * Specs for the source Calendar + iCal declares in its appinfo.
 *
 * The appinfo is JSON, so its `calendar/event` source is a hand copy of the framework's
 * `CALENDAR_EVENT_SOURCE`, which declares what the framework sends. The Pebble app drops any property
 * the copy leaves out, and refuses the read of the phone's calendars without its `callerPermissions`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test, expect } from 'vitest';
import { CALENDAR_EVENT_SOURCE } from '../../paf/ts/plugin-app/calendar';

const APPINFO = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', 'pebble.appinfo.json'), 'utf8'));

describe('the appinfo', () => {
  /** A property the copy leaves out never reaches a face, and a missing Calendar ask stops the phone's events. */
  test('declares the calendar source exactly as the framework serves it', () => {
    const result = APPINFO.plugin.sources;

    expect(result).toEqual([CALENDAR_EVENT_SOURCE]);
  });
});
