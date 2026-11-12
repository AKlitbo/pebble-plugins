/**
 * @file main.c
 * @brief Calendar Test Demo. A test face that shows the next few events the wearer's preferred
 * calendar plugin serves, each with its start, its title, and its calendar, and logs every agenda
 * that lands.
 */
#include <pebble.h>
#include <string.h>

#include "io/appmessage/appmessage.h"
#include "io/stores/calendar_store.h"
#include "io/stores/time_store.h"
#include "io/tuple_read.h"
#include "system/settings/settings.h"
#include "report.h"
#include "screen.h"

#define TITLE PBL_IF_ROUND_ELSE("Calendar Test", "Calendar Test Demo")
#define ACCENT GColorRajah

// the store snapshot's persist key. 249 stays free for the framework's plugin choice
#define CALENDAR_STORE_KEY 254

// asks the phone this often. the plugin sends on every change anyway, so this only resends the last
#define CALENDAR_POLL_MIN 10

// room for a full agenda and the calendars' names beside it
#define INBOX_SIZE 2048

#define NAME_LEN 24
#define TIME_LEN 8
#define DAY_LEN 16

// an event's row, with its calendar on a small line under it
static const ScreenStyle STYLE = {
    .label_font = FONT_KEY_GOTHIC_18,
    .value_font = FONT_KEY_GOTHIC_18_BOLD,
    .row_h = 22,
    .label_w = 52,
    .gutter_x = 92,
};

static Window *s_window;

static char s_names[CALENDAR_SLOTS_MAX][NAME_LEN]; ///< each slot's calendar, sent beside the agenda, empty for none

/** @brief Writes an event's start the way the watch's clock reads, such as "9:30" or "14:30". */
static void write_start(char *out, size_t size, const CalendarEvent *event)
{
    if (event->all_day)
    {
        snprintf(out, size, "All day");
        return;
    }

    struct tm *start = localtime(&event->start);
    strftime(out, size, clock_is_24h_style() ? "%H:%M" : "%I:%M", start);

    // a 12 hour clock reads 9:30 rather than 09:30
    if (!clock_is_24h_style() && out[0] == '0')
    {
        memmove(out, out + 1, strlen(out));
    }
}

/**
 * @brief Writes the section an event falls under, such as "TODAY" or "FRI 14 NOV". An event that
 * started before today and still runs falls under today.
 */
static void write_day(char *out, size_t size, time_t start, time_t today)
{
    if (start < today + SECONDS_PER_DAY)
    {
        snprintf(out, size, "TODAY");
        return;
    }

    if (start < today + 2 * SECONDS_PER_DAY)
    {
        snprintf(out, size, "TOMORROW");
        return;
    }

    strftime(out, size, "%a %d %b", localtime(&start));

    for (char *letter = out; *letter; letter++)
    {
        if (*letter >= 'a' && *letter <= 'z')
        {
            *letter = (char)(*letter - 'a' + 'A');
        }
    }
}

/**
 * @brief Adds every event that has not ended yet, opening a section each time the day changes, and
 * says how many it added.
 */
static int add_events(void)
{
    time_t now = time(NULL);
    time_t today = time_start_of_today();
    char section[DAY_LEN] = "";
    int shown = 0;

    for (uint8_t index = 0; index < CALENDAR_SLOTS_MAX; index++)
    {
        const CalendarEvent *event = calendar_store_event(index);
        char day[DAY_LEN];
        char start[TIME_LEN];

        if (!event)
        {
            break;
        }

        if (event->end <= now)
        {
            continue;
        }

        write_day(day, sizeof(day), event->start, today);

        if (strcmp(day, section) != 0)
        {
            snprintf(section, sizeof(section), "%s", day);
            screen_section(section);
        }

        write_start(start, sizeof(start), event);
        screen_row(start, event->title[0] ? event->title : "(no title)");

        if (s_names[index][0])
        {
            screen_note(s_names[index]);
        }

        shown++;
    }

    return shown;
}

/** @brief Fills the screen from the store and the report. */
static void redraw(void)
{
    int age = calendar_store_age_s();

    screen_begin(report_plugin(), age);

    if (report_error()[0])
    {
        screen_message("plugin error", report_error());
    }
    else if (age < 0)
    {
        screen_message("no update yet", "waiting");
    }
    else if (add_events() == 0)
    {
        screen_message("the plugin sent none", "no events");
    }

    screen_end();
}

/** @brief Logs every event the store holds, one short line each. */
static void log_agenda(void)
{
    const CalendarStrip *strip = calendar_store_strip();
    uint8_t count = strip ? strip->count : 0;

    char age[8];

    screen_age_text(age, sizeof(age), calendar_store_age_s());
    APP_LOG(APP_LOG_LEVEL_INFO, "calendar-test-demo from '%s', error '%s', %d events, age %s", report_plugin(), report_error(), count, age);

    for (uint8_t index = 0; index < count; index++)
    {
        const CalendarEvent *event = calendar_store_event(index);

        if (event)
        {
            APP_LOG(APP_LOG_LEVEL_INFO, "  event %d: %ld to %ld%s '%s' in '%s'", index, (long)event->start, (long)event->end,
                    event->all_day ? " all day" : "", event->title, s_names[index]);
        }
    }
}

/** @brief Reads the calendars' names off an agenda before the framework reads the message. */
static void read_own(DictionaryIterator *iterator)
{
    const char *names = tuple_str_or(dict_find(iterator, MESSAGE_KEY_TEST_CALENDARS), NULL);

    if (names)
    {
        report_split_lines(names, &s_names[0][0], NAME_LEN, CALENDAR_SLOTS_MAX);
    }
}

/** @brief A message landed and the framework has read it, so log what the face now holds and redraw. */
static void on_message(void)
{
    log_agenda();
    redraw();
}

static void window_load(Window *window)
{
    screen_create(window, TITLE, ACCENT, &STYLE);
    redraw();
}

static void window_unload(Window *window)
{
    screen_destroy();
}

/** @brief The minute moved, so the age changes and an event may have ended. */
static void on_time_changed(void)
{
    redraw();
}

static void init(void)
{
    // each launch starts empty, so everything on the screen came from the plugin this run
    persist_delete(CALENDAR_STORE_KEY);

    // no settings of its own, but the inbox reads the settings table on every message
    settings_init(NULL);

    time_store_init((TimeConfig){.live = true, .minute_tick = true}, NULL);
    calendar_store_init((CalendarConfig){.live = true, .poll_min = CALENDAR_POLL_MIN, .persist_key = CALENDAR_STORE_KEY}, NULL);

    s_window = window_create();
    window_set_background_color(s_window, GColorBlack);
    window_set_window_handlers(s_window, (WindowHandlers){.load = window_load, .unload = window_unload});
    window_stack_push(s_window, true);

    // every store change arrives in a message, and on_message redraws once after the framework has
    // read it, so the stores need no redraw of their own. only the clock moves without one
    time_store_subscribe(on_time_changed);

    appmessage_open(INBOX_SIZE);
    report_init(read_own, on_message);
    APP_LOG(APP_LOG_LEVEL_INFO, "calendar-test-demo launched, waiting for the plugin");
}

static void deinit(void)
{
    window_destroy(s_window);
}

int main(void)
{
    init();
    app_event_loop();
    deinit();
}
