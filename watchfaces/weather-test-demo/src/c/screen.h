/**
 * @file screen.h
 * @brief The one screen every test face draws. A header names the face, the plugin that answered, and
 * how old the reading is. Under it sit label and value rows in two lined up columns, grouped under small
 * grey section labels. A face fills the rows afresh each time something changes, and the screen
 * draws whatever fits.
 *
 * On a round screen the title stays at the top and the plugin and the age move to a footer at the
 * bottom, where the circle is too narrow for rows. The labels then line up against a gutter down the
 * middle, with the values on the other side of it, so every row keeps inside the circle.
 *
 * The three test faces keep the same copy of this file, since a paf unit only builds what sits inside
 * its own folder. A fix to one copy goes into the other two.
 */
#pragma once
#include <pebble.h>

/** @brief How a face sets its rows. */
typedef struct
{
    const char *label_font; ///< the labels' system font, such as FONT_KEY_GOTHIC_14
    const char *value_font; ///< the values' system font, such as FONT_KEY_GOTHIC_14_BOLD
    int16_t     row_h;      ///< how far apart the rows sit
    int16_t     label_w;    ///< how wide the label column is on a square screen
    int16_t     gutter_x;   ///< where the labels end and the values start on a round screen
} ScreenStyle;

/**
 * @brief Puts the screen in a window. Call it from the window's load handler.
 *
 * @param window The window to draw in.
 * @param title The face's name for the header. It is kept as it is, so pass a string that lasts.
 * @param accent The header's colour.
 * @param style How the face sets its rows. It is kept as it is, so pass one that lasts.
 */
void screen_create(Window *window, const char *title, GColor accent, const ScreenStyle *style);

/** @brief Takes the screen down again. Call it from the window's unload handler. */
void screen_destroy(void);

/**
 * @brief Starts filling the screen afresh, with what the header shows.
 *
 * @param plugin The plugin that answered, or empty for none yet, which shows as a dash.
 * @param age_s How many seconds old the reading is, or -1 for none.
 */
void screen_begin(const char *plugin, int age_s);

/**
 * @brief Opens a section with its small grey label.
 *
 * @param name The section's name, such as "NOW".
 */
void screen_section(const char *name);

/**
 * @brief Adds a label and value row.
 *
 * @param label The label, in light grey.
 * @param value The value, in white. Empty shows as a dash.
 */
void screen_row(const char *label, const char *value);

/**
 * @brief Adds a row with a second value set against the right edge, such as a stock's change beside
 * its price. A round screen writes it after the value instead, since its right edge moves row to row.
 *
 * @param label The label, in light grey.
 * @param value The value, in white. Empty shows as a dash.
 * @param aside The second value, in white.
 */
void screen_row_aside(const char *label, const char *value, const char *aside);

/**
 * @brief Adds a small grey line under the value of the row above, such as an event's calendar.
 *
 * @param text The line.
 */
void screen_note(const char *text);

/**
 * @brief Shows one message in place of every row, such as "waiting" or the plugin's error.
 *
 * @param caption The small grey line above it, such as "plugin error".
 * @param text The message itself.
 */
void screen_message(const char *caption, const char *text);

/** @brief Finishes filling the screen and has it drawn. */
void screen_end(void);

/**
 * @brief Writes a reading's age the short way the header shows it, such as "now", "4m", or "2h".
 *
 * @param out Where to write it.
 * @param size How big out is.
 * @param age_s How many seconds old the reading is, or -1 for none, which writes a dash.
 */
void screen_age_text(char *out, size_t size, int age_s);
