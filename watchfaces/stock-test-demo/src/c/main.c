/**
 * @file main.c
 * @brief Stock Test Demo. A test face that shows the quotes the wearer's preferred stock plugin
 * serves, one row per ticker, and logs every strip that lands.
 */
#include <pebble.h>
#include <string.h>

#include "io/appmessage/appmessage.h"
#include "io/stores/stock_store.h"
#include "io/stores/time_store.h"
#include "io/tuple_read.h"
#include "system/settings/settings.h"
#include "text/number_format.h"
#include "report.h"
#include "screen.h"

#define TITLE PBL_IF_ROUND_ELSE("Stock Test", "Stock Test Demo")
#define ACCENT GColorMayGreen

// the store snapshot's persist key. 249 stays free for the framework's plugin choice
#define STOCK_STORE_KEY 254

// asks the phone this often, short so a test has plenty of strips to watch
#define STOCK_POLL_MIN 5

// room for a strip of four quotes and the report beside it
#define INBOX_SIZE 2048

#define PRICE_LEN 16
#define CHANGE_LEN 12
#define LABEL_LEN 16

// four rows at most, so the larger fonts fit
static const ScreenStyle STYLE = {
    .label_font = FONT_KEY_GOTHIC_18,
    .value_font = FONT_KEY_GOTHIC_18_BOLD,
    .row_h = 22,
    .label_w = 70,
    .gutter_x = 104,
};

static Window *s_window;

static char s_tickers[STOCK_SLOTS_MAX][STOCK_SYMBOL_LEN]; ///< each slot's ticker, sent beside the strip, empty for none

/**
 * @brief Adds one slot's row. A quote shows its ticker, price, and change. A failed one shows its
 * ticker beside the plugin's word for why, since the strip carries that word in place of the ticker.
 */
static void add_slot(uint8_t index, const StockSlot *slot)
{
    char numbered[LABEL_LEN];
    const char *label = s_tickers[index];

    // a slot the phone sent no ticker for goes by its place in the strip
    if (!label[0])
    {
        snprintf(numbered, sizeof(numbered), "Slot %d", index + 1);
        label = numbered;
    }

    if (slot->ok)
    {
        char price[PRICE_LEN];
        char change[CHANGE_LEN];

        fmt_hundredths(price, sizeof(price), slot->price_cents);
        fmt_pct_signed(change, sizeof(change), slot->change_pct);
        screen_row_aside(slot->symbol, price, change);
    }
    else
    {
        screen_row(label, slot->symbol);
    }
}

/** @brief Fills the screen from the store and the report. */
static void redraw(void)
{
    int age = stock_store_age_s();
    const StockStrip *strip = stock_store_strip();
    uint8_t count = strip ? strip->count : 0;

    screen_begin(report_plugin(), age);

    if (report_error()[0])
    {
        screen_message("plugin error", report_error());
    }
    else if (age < 0)
    {
        screen_message("no update yet", "waiting");
    }
    else if (count == 0)
    {
        screen_message("the plugin sent none", "no quotes");
    }
    else
    {
        screen_section("QUOTES");

        for (uint8_t index = 0; index < count; index++)
        {
            const StockSlot *slot = stock_store_slot(index);

            if (slot)
            {
                add_slot(index, slot);
            }
        }
    }

    screen_end();
}

/** @brief Logs every slot the store holds, one short line each. */
static void log_strip(void)
{
    const StockStrip *strip = stock_store_strip();
    uint8_t count = strip ? strip->count : 0;

    char age[8];

    screen_age_text(age, sizeof(age), stock_store_age_s());
    APP_LOG(APP_LOG_LEVEL_INFO, "stock-test-demo from '%s', error '%s', %d slots, age %s", report_plugin(), report_error(), count, age);

    for (uint8_t index = 0; index < count; index++)
    {
        const StockSlot *slot = stock_store_slot(index);

        if (!slot)
        {
            continue;
        }

        if (slot->ok)
        {
            char price[PRICE_LEN];
            char change[CHANGE_LEN];

            fmt_hundredths(price, sizeof(price), slot->price_cents);
            fmt_pct_signed(change, sizeof(change), slot->change_pct);
            APP_LOG(APP_LOG_LEVEL_INFO, "  slot %d: %s %s %s", index, slot->symbol, price, change);
        }
        else
        {
            APP_LOG(APP_LOG_LEVEL_INFO, "  slot %d: '%s' status %s", index, s_tickers[index], slot->symbol);
        }
    }
}

/** @brief Reads the tickers off a report before the framework reads the message. */
static void read_own(DictionaryIterator *iterator)
{
    const char *tickers = tuple_str_or(dict_find(iterator, MESSAGE_KEY_TEST_TICKERS), NULL);

    if (tickers)
    {
        report_split_lines(tickers, &s_tickers[0][0], STOCK_SYMBOL_LEN, STOCK_SLOTS_MAX);
    }
}

/** @brief A message landed and the framework has read it, so log what the face now holds and redraw. */
static void on_message(void)
{
    log_strip();
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
    persist_delete(STOCK_STORE_KEY);

    // no settings of its own, but the inbox reads the settings table on every message
    settings_init(NULL);

    time_store_init((TimeConfig){.live = true, .minute_tick = true}, NULL);
    stock_store_init((StockConfig){.live = true, .poll_min = STOCK_POLL_MIN, .persist_key = STOCK_STORE_KEY}, NULL);

    s_window = window_create();
    window_set_background_color(s_window, GColorBlack);
    window_set_window_handlers(s_window, (WindowHandlers){.load = window_load, .unload = window_unload});
    window_stack_push(s_window, true);

    // every store change arrives in a message, and on_message redraws once after the framework has
    // read it, so the stores need no redraw of their own. only the clock moves without one
    time_store_subscribe(on_time_changed);

    appmessage_open(INBOX_SIZE);
    report_init(read_own, on_message);
    APP_LOG(APP_LOG_LEVEL_INFO, "stock-test-demo launched, waiting for the plugin");
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
