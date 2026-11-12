/**
 * PebbleKit JS entry point for Calendar Test Demo.
 *
 * Starts the app with the calendar alone, read from the wearer's preferred calendar plugin. It has no
 * settings of its own and no iCal link, so the page holds only the calendar's notes and the supported
 * plugins panel.
 */
import app from '../../paf/ts/pkjs/app';
import calendar from '../../paf/ts/calendar/feature';
import { createAgendaNames, describeAgenda } from './calendar-keys';
import { watchPlugin } from './plugin-watch';

const names = createAgendaNames();

app.startPebbleApp({
  clayConfig: [],
  features: [
    watchPlugin({ name: 'calendar-test-demo', category: 'calendar', item: 'event', summary: ['name', 'starts_at'], describeValue: describeAgenda, noticeSend: names.noticeSend, extras: names.extras }),
    calendar,
  ],
});
