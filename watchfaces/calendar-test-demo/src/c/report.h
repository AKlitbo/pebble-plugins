/**
 * @file report.h
 * @brief The report the phone sends after each plugin update or error: which plugin answered, and
 * the plugin's error if it sent one. The framework's stores keep the reading itself, and this keeps
 * what the header needs beside it.
 *
 * It reads every message before the framework does, so a face can read its own keys off the same
 * message too, then hands the message on whole.
 *
 * The three test faces keep the same copy of this file, since a paf unit only builds what sits inside
 * its own folder. A fix to one copy goes into the other two.
 */
#pragma once
#include <pebble.h>

/**
 * @brief Starts reading the report. Call it right after appmessage_open, which sets up the inbox
 * this goes in front of.
 *
 * @param read_own Reads the face's own keys off each message, or NULL for none. It runs before the
 *   framework reads the message, so anything it keeps is ready by the time a store asks for a redraw.
 * @param changed Runs after each message, once the framework has read it too, to redraw and log.
 */
void report_init(void (*read_own)(DictionaryIterator *iterator), void (*changed)(void));

/** @brief The plugin that answered last, or empty before one has. */
const char *report_plugin(void);

/** @brief The plugin's error, such as PLUGIN_UNAVAILABLE, or empty once an update has landed since. */
const char *report_error(void);

/**
 * @brief Splits text the phone sends one item per line into fixed rows, such as one ticker per slot.
 * A row past the last line is left empty, and a line too long for its row is cut.
 *
 * @param joined The text, one item per line.
 * @param rows The first row. The rows sit one after another, each width bytes long.
 * @param width How long each row is, its terminator included.
 * @param count How many rows there are.
 */
void report_split_lines(const char *joined, char *rows, size_t width, uint8_t count);
