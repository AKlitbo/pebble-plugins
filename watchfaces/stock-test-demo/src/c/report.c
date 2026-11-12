/**
 * @file report.c
 * @brief Reads the phone's report off each message before the framework does. See report.h.
 *
 * The three test faces keep the same copy of this file, since a paf unit only builds what sits inside
 * its own folder. A fix to one copy goes into the other two.
 */
#include "report.h"

#include <string.h>

#include "io/tuple_read.h"

#define PLUGIN_LEN 32
#define ERROR_LEN 32

static AppMessageInboxReceived s_framework_inbox; ///< the framework's own inbox, which every message goes on to
static void (*s_read_own)(DictionaryIterator *iterator);
static void (*s_changed)(void);

static char s_plugin[PLUGIN_LEN];
static char s_error[ERROR_LEN];

/**
 * @brief Reads the report and the face's own keys, then hands the message on to the framework.
 *
 * The SDK hands back the framework's callback when this one takes its place, so every message still
 * reaches it whole.
 */
static void inbox_received(DictionaryIterator *iterator, void *context)
{
    const char *plugin = tuple_str_or(dict_find(iterator, MESSAGE_KEY_TEST_PLUGIN), NULL);
    const char *error = tuple_str_or(dict_find(iterator, MESSAGE_KEY_TEST_ERROR), NULL);

    if (plugin)
    {
        snprintf(s_plugin, sizeof(s_plugin), "%s", plugin);
    }

    if (error)
    {
        snprintf(s_error, sizeof(s_error), "%s", error);
    }

    if (s_read_own)
    {
        s_read_own(iterator);
    }

    if (s_framework_inbox)
    {
        s_framework_inbox(iterator, context);
    }

    // the stores have taken their part by now, so the face redraws once from all of it. a message the
    // stores keep nothing from, such as a failed weather reading, still lands on the screen this way
    if (s_changed)
    {
        s_changed();
    }
}

void report_init(void (*read_own)(DictionaryIterator *iterator), void (*changed)(void))
{
    s_read_own = read_own;
    s_changed = changed;
    s_framework_inbox = app_message_register_inbox_received(inbox_received);
}

const char *report_plugin(void)
{
    return s_plugin;
}

const char *report_error(void)
{
    return s_error;
}

void report_split_lines(const char *joined, char *rows, size_t width, uint8_t count)
{
    const char *start = joined;

    for (uint8_t row = 0; row < count; row++)
    {
        const char *end = start ? strchr(start, '\n') : NULL;
        size_t length = start ? (end ? (size_t)(end - start) : strlen(start)) : 0;

        snprintf(rows + row * width, width, "%.*s", (int)length, start ? start : "");
        start = end ? end + 1 : NULL;
    }
}
