/**
 * @file main.c
 * @brief Weather Test Demo. A test face that shows what the wearer's preferred weather plugin serves,
 * with the extras a plugin can add beside the standard reading, and logs every update that lands.
 */
#include <pebble.h>
#include <string.h>

#include "io/appmessage/appmessage.h"
#include "io/stores/location_store.h"
#include "io/stores/time_store.h"
#include "io/stores/weather_store.h"
#include "io/tuple_read.h"
#include "system/settings/settings.h"
#include "report.h"
#include "screen.h"

#define TITLE PBL_IF_ROUND_ELSE("Weather Test", "Weather Test Demo")
#define ACCENT GColorPictonBlue

// the store snapshots' persist keys. 249 stays free for the framework's plugin choice
#define WEATHER_STORE_KEY 254
#define LOCATION_STORE_KEY 253

// asks the phone this often. the plugin sends on every change anyway, so this only resends the last
#define WEATHER_POLL_MIN 10

// room for a weather message with every key this face reads
#define INBOX_SIZE 2048

#define VALUE_LEN 40
#define PLACE_LEN 32
#define STATUS_LEN 24

// what the phone sends for a plugin with no WMO code
#define NO_WMO -1

// a round screen's rows are narrower, so the coordinates lose two places to fit
#define COORD_PLACES PBL_IF_ROUND_ELSE(2, 4)

// nine short rows, so the small fonts set close fit them all with their section labels
static const ScreenStyle STYLE = {
    .label_font = FONT_KEY_GOTHIC_14,
    .value_font = FONT_KEY_GOTHIC_14_BOLD,
    .row_h = 15,
    .label_w = 66,
    .gutter_x = 118,
};

static Window *s_window;

static char s_place[PLACE_LEN];   ///< the first place's name as the plugin sent it, empty for none
static int  s_wmo = NO_WMO;       ///< the first place's WMO code as the plugin sent it
static char s_status[STATUS_LEN]; ///< the framework's word for a failed weather message, empty while it is fine

/** @brief Writes a number with what follows it, or leaves the value empty for the no-data value. */
static void write_number(char *out, size_t size, int value, int none, const char *after)
{
    if (value == none)
    {
        out[0] = '\0';
    }
    else
    {
        snprintf(out, size, "%d%s", value, after);
    }
}

/** @brief Copies a coordinate with no more than a few decimal places. */
static void write_coord(char *out, size_t size, const char *coord, int places)
{
    const char *dot = strchr(coord, '.');
    size_t keep = dot ? (size_t)(dot - coord) + 1 + places : strlen(coord);

    snprintf(out, size, "%.*s", (int)keep, coord);
}

/** @brief The temperature now and the sky beside it, such as "4° Overcast". */
static void write_now(char *out, size_t size)
{
    const char *sky = weather_store_cond_label();

    write_number(out, size, weather_store_temp(), WEATHER_NO_TEMP, "°");

    if (out[0] && sky[0])
    {
        size_t used = strlen(out);
        snprintf(out + used, size - used, "  %s", sky);
    }
}

static void write_feels_like(char *out, size_t size)
{
    write_number(out, size, weather_store_feels_like(), WEATHER_NO_TEMP, "°");
}

/** @brief Today's high, low, and chance of rain, such as "8° / 1° / 40%". */
static void write_today(char *out, size_t size)
{
    char high[8];
    char low[8];
    char rain[8];

    write_number(high, sizeof(high), weather_store_temp_max(), WEATHER_NO_TEMP, "°");
    write_number(low, sizeof(low), weather_store_temp_min(), WEATHER_NO_TEMP, "°");
    write_number(rain, sizeof(rain), weather_store_precip_chance(), -1, "%");

    if (high[0] || low[0] || rain[0])
    {
        snprintf(out, size, "%s / %s / %s", high[0] ? high : "-", low[0] ? low : "-", rain[0] ? rain : "-");
    }
    else
    {
        out[0] = '\0';
    }
}

// the plainer rows, each leaving the value empty when the reading has none
static void write_pressure(char *out, size_t size)
{
    write_number(out, size, weather_store_pressure(), -1, " hPa");
}

static void write_dew_point(char *out, size_t size)
{
    write_number(out, size, weather_store_dew_point(), WEATHER_NO_TEMP, "°");
}

static void write_uv(char *out, size_t size)
{
    write_number(out, size, weather_store_uv(), -1, "");
}

static void write_wmo(char *out, size_t size)
{
    write_number(out, size, s_wmo, NO_WMO, "");
}

static void write_place(char *out, size_t size)
{
    snprintf(out, size, "%s", s_place);
}

/** @brief The coordinates as one pair, or the phone's word for none, such as "NO FIX". */
static void write_coords(char *out, size_t size)
{
    const char *lat = location_store_lat();
    const char *lon = location_store_lon();

    if (!lat[0] || !lon[0])
    {
        out[0] = '\0';
    }
    else if (!strchr(lat, '.'))
    {
        snprintf(out, size, "%s", lat);
    }
    else
    {
        char lat_text[16];
        char lon_text[16];

        write_coord(lat_text, sizeof(lat_text), lat, COORD_PLACES);
        write_coord(lon_text, sizeof(lon_text), lon, COORD_PLACES);
        snprintf(out, size, "%s, %s", lat_text, lon_text);
    }
}

/** @brief One row of the screen: the section it opens, if any, its label, and how to write its value. */
typedef struct
{
    const char *section;                    ///< the section this row opens, or NULL to carry on the one above
    const char *label;                      ///< the row's label
    void (*write_value)(char *out, size_t size); ///< writes the row's value, or leaves it empty for a dash
} WeatherRow;

static const WeatherRow ROWS[] = {
    {"NOW", "Temp", write_now},
    {NULL, "Feels like", write_feels_like},
    {"TODAY", "Hi / lo / rain", write_today},
    {"EXTRAS", "Pressure", write_pressure},
    {NULL, "Dew point", write_dew_point},
    {NULL, "UV index", write_uv},
    {NULL, "WMO code", write_wmo},
    {"PLACE", "Name", write_place},
    {NULL, "Coords", write_coords},
};

/** @brief Fills the screen from the stores and the report. */
static void redraw(void)
{
    int age = weather_store_age_s();

    screen_begin(report_plugin(), age);

    if (report_error()[0])
    {
        screen_message("plugin error", report_error());
    }
    else if (s_status[0])
    {
        screen_message("weather status", s_status);
    }
    else if (age < 0)
    {
        screen_message("no update yet", "waiting");
    }
    else
    {
        for (size_t index = 0; index < ARRAY_LENGTH(ROWS); index++)
        {
            char value[VALUE_LEN];

            if (ROWS[index].section)
            {
                screen_section(ROWS[index].section);
            }

            ROWS[index].write_value(value, sizeof(value));
            screen_row(ROWS[index].label, value);
        }
    }

    screen_end();
}

/** @brief Logs what the screen shows, short enough for one line each. */
static void log_weather(void)
{
    char age[8];

    screen_age_text(age, sizeof(age), weather_store_age_s());
    APP_LOG(APP_LOG_LEVEL_INFO, "weather-test-demo from '%s', error '%s', status '%s', age %s", report_plugin(), report_error(), s_status, age);
    APP_LOG(APP_LOG_LEVEL_INFO, "  temp %d feels %d sky '%s' hi %d lo %d rain %d", weather_store_temp(), weather_store_feels_like(), weather_store_cond_label(),
            weather_store_temp_max(), weather_store_temp_min(), weather_store_precip_chance());
    APP_LOG(APP_LOG_LEVEL_INFO, "  pressure %d dew %d uv %d wmo %d", weather_store_pressure(), weather_store_dew_point(), weather_store_uv(),
            s_wmo);
    APP_LOG(APP_LOG_LEVEL_INFO, "  place '%s' lat '%s' lon '%s'", s_place, location_store_lat(), location_store_lon());
}

/**
 * @brief Reads the face's own keys, and the status of a weather message, before the framework reads it.
 *
 * The weather store keeps a failed message's status out of its reading, so the face reads it here.
 */
static void read_own(DictionaryIterator *iterator)
{
    const char *place = tuple_str_or(dict_find(iterator, MESSAGE_KEY_TEST_PLACE), NULL);
    Tuple *wmo = dict_find(iterator, MESSAGE_KEY_TEST_WMO);
    const char *cond = tuple_str_or(dict_find(iterator, MESSAGE_KEY_WEATHER_CONDITIONS), NULL);

    if (place)
    {
        snprintf(s_place, sizeof(s_place), "%s", place);
    }

    if (wmo)
    {
        s_wmo = (int)tuple_int_or(wmo, NO_WMO);
    }

    if (cond)
    {
        bool ok = tuple_int_or(dict_find(iterator, MESSAGE_KEY_WEATHER_OK), 0) == 1;
        snprintf(s_status, sizeof(s_status), "%s", ok ? "" : cond);
    }
}

/** @brief A message landed and the framework has read it, so log what the face now holds and redraw. */
static void on_message(void)
{
    log_weather();
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

/** @brief The minute moved, so the age in the header changes. */
static void on_time_changed(void)
{
    redraw();
}

static void init(void)
{
    // each launch starts empty, so everything on the screen came from the plugin this run
    persist_delete(WEATHER_STORE_KEY);
    persist_delete(LOCATION_STORE_KEY);

    // no settings of its own, but the inbox reads the settings table on every message
    settings_init(NULL);

    time_store_init((TimeConfig){.live = true, .minute_tick = true}, NULL);
    weather_store_init((WeatherConfig){.live = true, .poll_min = WEATHER_POLL_MIN, .persist_key = WEATHER_STORE_KEY}, NULL);
    location_store_init((LocationConfig){.live = true, .persist_key = LOCATION_STORE_KEY}, NULL);

    s_window = window_create();
    window_set_background_color(s_window, GColorBlack);
    window_set_window_handlers(s_window, (WindowHandlers){.load = window_load, .unload = window_unload});
    window_stack_push(s_window, true);

    // every store change arrives in a message, and on_message redraws once after the framework has
    // read it, so the stores need no redraw of their own. only the clock moves without one
    time_store_subscribe(on_time_changed);

    appmessage_open(INBOX_SIZE);
    report_init(read_own, on_message);
    APP_LOG(APP_LOG_LEVEL_INFO, "weather-test-demo launched, waiting for the plugin");
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
