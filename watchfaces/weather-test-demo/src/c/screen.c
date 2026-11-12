/**
 * @file screen.c
 * @brief Draws the test faces' screen from the lines a face hands it. See screen.h.
 *
 * The three test faces keep the same copy of this file, since a paf unit only builds what sits inside
 * its own folder. A fix to one copy goes into the other two.
 */
#include "screen.h"

#include <stdlib.h>
#include <string.h>

// how many lines a face can hand over, more than any screen fits
#define LINES_MAX 24

#define LABEL_LEN 24
#define VALUE_LEN 40
#define ASIDE_LEN 16
#define PLUGIN_LEN 32
#define AGE_LEN 8

// the space between the label and value columns
#define COLUMN_GAP 6

// a section label's line, a little taller than its text so it sits apart from the rows above
#define SECTION_H 12

// a note's line, such as an event's calendar
#define NOTE_H 16

// a text box is taller than its line, so a font's descenders are never cut off
#define BOX_SLACK 6

// the system fonts leave a few empty pixels above their letters, and the circle only has to clear
// the letters themselves
#define FONT_TOP_PAD 4

// the square screen. the header holds the title, then the plugin and the age, then a rule
#define RECT_INSET 6
#define RECT_TITLE_Y -2
#define RECT_TITLE_H 24
#define RECT_SOURCE_Y 20
#define RECT_RULE_Y 39
#define RECT_BODY_TOP 42
#define RECT_BODY_BOTTOM_GAP 2

// the round screen. the title at the top, the plugin and the age in a footer, and rows kept this far
// inside the circle
#define ROUND_TITLE_Y 14
#define ROUND_TITLE_H 24
#define ROUND_RULE_Y 37
#define ROUND_RULE_W 40
#define ROUND_BODY_TOP 40
#define ROUND_BODY_BOTTOM 224
#define ROUND_FOOTER_Y 224
#define ROUND_MARGIN 6

// the message shown in place of the rows. a long one such as PLUGIN_UNAVAILABLE takes the smaller font
#define MESSAGE_CAPTION_H 18
#define MESSAGE_BIG_MAX 12
#define MESSAGE_BIG_H 30
#define MESSAGE_SMALL_H 24

typedef enum
{
    LINE_SECTION,
    LINE_ROW,
    LINE_NOTE,
} LineKind;

typedef struct
{
    LineKind kind;
    char     label[LABEL_LEN]; ///< a row's label, or a section's name
    char     value[VALUE_LEN]; ///< a row's value, or a note's text
    char     aside[ASIDE_LEN]; ///< a row's second value, empty for none
} Line;

static Layer             *s_layer;
static const char        *s_title;
static GColor             s_accent;
static const ScreenStyle *s_style;

static Line    s_lines[LINES_MAX];
static uint8_t s_count;
static char    s_plugin[PLUGIN_LEN];
static char    s_age[AGE_LEN];
static char    s_caption[VALUE_LEN]; ///< the message's caption, empty while the rows show
static char    s_message[VALUE_LEN];

/** @brief Copies a string into a fixed buffer, cut to fit. */
static void copy(char *out, size_t size, const char *text)
{
    snprintf(out, size, "%s", text ? text : "");
}

/** @brief The next free line, or NULL once the store is full. */
static Line *next_line(LineKind kind)
{
    if (s_count >= LINES_MAX)
    {
        return NULL;
    }

    Line *line = &s_lines[s_count++];
    memset(line, 0, sizeof(*line));
    line->kind = kind;
    return line;
}

void screen_age_text(char *out, size_t size, int age_s)
{
    if (age_s < 0)
    {
        copy(out, size, "-");
    }
    else if (age_s < SECONDS_PER_MINUTE)
    {
        copy(out, size, "now");
    }
    else if (age_s < SECONDS_PER_HOUR)
    {
        snprintf(out, size, "%dm", age_s / SECONDS_PER_MINUTE);
    }
    else if (age_s < SECONDS_PER_DAY)
    {
        snprintf(out, size, "%dh", age_s / SECONDS_PER_HOUR);
    }
    else
    {
        snprintf(out, size, "%dd", age_s / SECONDS_PER_DAY);
    }
}

/** @brief Draws one line of text in a box, cut short with an ellipsis when it runs long. */
static void draw_text(GContext *ctx, const char *text, const char *font, GRect box, GTextAlignment align, GColor colour)
{
    graphics_context_set_text_color(ctx, colour);
    graphics_draw_text(ctx, text, fonts_get_system_font(font), box, GTextOverflowModeTrailingEllipsis, align, NULL);
}

/** @brief How tall a line is. */
static int16_t line_h(const Line *line)
{
    switch (line->kind)
    {
        case LINE_SECTION:
            return SECTION_H;
        case LINE_NOTE:
            return NOTE_H;
        default:
            return s_style->row_h;
    }
}

#if defined(PBL_ROUND)
/** @brief A whole number's square root, rounded down. */
static int16_t root_of(int32_t value)
{
    int32_t root = 0;

    while ((root + 1) * (root + 1) <= value)
    {
        root++;
    }

    return (int16_t)root;
}

/**
 * @brief How far either side of the middle a band of the round screen reaches, measured at whichever
 * of its edges is further from the centre, so text anywhere in the band stays inside the circle.
 */
static int16_t half_width_at(GRect bounds, int16_t top, int16_t bottom)
{
    int16_t radius = bounds.size.w / 2;
    int16_t centre = bounds.size.h / 2;
    int16_t far = abs(top - centre) > abs(bottom - centre) ? abs(top - centre) : abs(bottom - centre);

    if (far >= radius)
    {
        return 0;
    }

    return root_of((int32_t)radius * radius - (int32_t)far * far) - ROUND_MARGIN;
}
#endif

/** @brief Where a line's text can go across the screen. */
typedef struct
{
    int16_t left;    ///< where the label can start
    int16_t value_x; ///< where the value starts
    int16_t right;   ///< where the value has to end
} Columns;

/** @brief Works out a line's columns at its height, which on a round screen narrow towards the top and bottom. */
static Columns columns_at(GRect bounds, int16_t y, int16_t h)
{
#if defined(PBL_ROUND)
    int16_t half = half_width_at(bounds, y + FONT_TOP_PAD, y + h);
    int16_t middle = bounds.size.w / 2;

    return (Columns){.left = middle - half, .value_x = s_style->gutter_x + COLUMN_GAP / 2, .right = middle + half};
#else
    return (Columns){.left = RECT_INSET, .value_x = RECT_INSET + s_style->label_w + COLUMN_GAP, .right = bounds.size.w - RECT_INSET};
#endif
}

/** @brief Draws a section's label, and on a square screen a thin rule running on from it. */
static void draw_section(GContext *ctx, GRect bounds, const Line *line, int16_t y)
{
    Columns cols = columns_at(bounds, y, SECTION_H);
    GRect box = GRect(cols.left, y - 1, cols.right - cols.left, SECTION_H + BOX_SLACK);

#if defined(PBL_ROUND)
    draw_text(ctx, line->label, FONT_KEY_GOTHIC_14_BOLD, box, GTextAlignmentCenter, GColorLightGray);
#else
    GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
    GSize size = graphics_text_layout_get_content_size(line->label, font, box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
    int16_t rule_y = y + SECTION_H / 2 + 1;

    draw_text(ctx, line->label, FONT_KEY_GOTHIC_14_BOLD, box, GTextAlignmentLeft, GColorLightGray);
    graphics_context_set_stroke_color(ctx, GColorDarkGray);
    graphics_draw_line(ctx, GPoint(cols.left + size.w + COLUMN_GAP, rule_y), GPoint(cols.right, rule_y));
#endif
}

/** @brief Draws a label and value row. */
static void draw_row(GContext *ctx, GRect bounds, const Line *line, int16_t y)
{
    int16_t h = s_style->row_h;
    Columns cols = columns_at(bounds, y, h);
    const char *value = line->value[0] ? line->value : "-";

#if defined(PBL_ROUND)
    int16_t label_right = s_style->gutter_x - COLUMN_GAP / 2;
    char joined[VALUE_LEN + ASIDE_LEN + 2];

    if (line->aside[0])
    {
        snprintf(joined, sizeof(joined), "%s  %s", value, line->aside);
        value = joined;
    }

    draw_text(ctx, line->label, s_style->label_font, GRect(cols.left, y, label_right - cols.left, h + BOX_SLACK), GTextAlignmentRight, GColorLightGray);
    draw_text(ctx, value, s_style->value_font, GRect(cols.value_x, y, cols.right - cols.value_x, h + BOX_SLACK), GTextAlignmentLeft, GColorWhite);
#else
    GRect value_box = GRect(cols.value_x, y, cols.right - cols.value_x, h + BOX_SLACK);

    draw_text(ctx, line->label, s_style->label_font, GRect(cols.left, y, s_style->label_w, h + BOX_SLACK), GTextAlignmentLeft, GColorLightGray);
    draw_text(ctx, value, s_style->value_font, value_box, GTextAlignmentLeft, GColorWhite);

    if (line->aside[0])
    {
        draw_text(ctx, line->aside, s_style->value_font, value_box, GTextAlignmentRight, GColorWhite);
    }
#endif
}

/** @brief Draws a note under the value column. */
static void draw_note(GContext *ctx, GRect bounds, const Line *line, int16_t y)
{
    Columns cols = columns_at(bounds, y, NOTE_H);

    draw_text(ctx, line->value, FONT_KEY_GOTHIC_14, GRect(cols.value_x, y - 2, cols.right - cols.value_x, NOTE_H + BOX_SLACK), GTextAlignmentLeft, GColorLightGray);
}

/** @brief Draws the message in place of the rows, in the middle of the body. */
static void draw_message(GContext *ctx, GRect body)
{
    bool big = strlen(s_message) <= MESSAGE_BIG_MAX;
    const char *font = big ? FONT_KEY_GOTHIC_24_BOLD : FONT_KEY_GOTHIC_18_BOLD;
    int16_t text_h = big ? MESSAGE_BIG_H : MESSAGE_SMALL_H;
    int16_t top = body.origin.y + (body.size.h - MESSAGE_CAPTION_H - text_h) / 2;

    draw_text(ctx, s_caption, FONT_KEY_GOTHIC_14, GRect(body.origin.x, top, body.size.w, MESSAGE_CAPTION_H), GTextAlignmentCenter, GColorLightGray);
    draw_text(ctx, s_message, font, GRect(body.origin.x, top + MESSAGE_CAPTION_H, body.size.w, text_h + BOX_SLACK), GTextAlignmentCenter, GColorWhite);
}

/**
 * @brief Counts the lines that fit in the body from the top down, stopping at the first one that does
 * not. A section label with no room left for a line under it is left off, since it would head nothing.
 * Drawing and the round screen's centring both go by this, so they always agree.
 */
static uint8_t lines_that_fit(int16_t room, int16_t *height)
{
    int16_t total = 0;
    uint8_t count = 0;

    for (; count < s_count; count++)
    {
        int16_t h = line_h(&s_lines[count]);
        bool orphan = s_lines[count].kind == LINE_SECTION && (count + 1 >= s_count || total + h + line_h(&s_lines[count + 1]) > room);

        if (total + h > room || orphan)
        {
            break;
        }

        total += h;
    }

    *height = total;
    return count;
}

/** @brief Draws the lines that fit, from the top of the body down. */
static void draw_lines(GContext *ctx, GRect bounds, GRect body)
{
    int16_t height;
    uint8_t count = lines_that_fit(body.size.h, &height);
    int16_t y = body.origin.y;

#if defined(PBL_ROUND)
    // a short list sits in the middle, where the circle is widest
    y += (body.size.h - height) / 2;
#endif

    for (uint8_t index = 0; index < count; index++)
    {
        const Line *line = &s_lines[index];

        switch (line->kind)
        {
            case LINE_SECTION:
                draw_section(ctx, bounds, line, y);
                break;
            case LINE_NOTE:
                draw_note(ctx, bounds, line, y);
                break;
            default:
                draw_row(ctx, bounds, line, y);
                break;
        }

        y += line_h(line);
    }
}

/** @brief Draws the header, and on a round screen the footer, then works out where the body sits. */
static GRect draw_frame(GContext *ctx, GRect bounds)
{
    const char *plugin = s_plugin[0] ? s_plugin : "-";

    graphics_context_set_stroke_color(ctx, s_accent);

#if defined(PBL_ROUND)
    char footer[PLUGIN_LEN + AGE_LEN + 2];
    int16_t middle = bounds.size.w / 2;
    int16_t half = half_width_at(bounds, ROUND_TITLE_Y + FONT_TOP_PAD, ROUND_TITLE_Y + ROUND_TITLE_H);
    int16_t foot_half = half_width_at(bounds, ROUND_FOOTER_Y + FONT_TOP_PAD, ROUND_FOOTER_Y + NOTE_H);

    snprintf(footer, sizeof(footer), "%s  %s", plugin, s_age);
    draw_text(ctx, s_title, FONT_KEY_GOTHIC_18_BOLD, GRect(middle - half, ROUND_TITLE_Y, 2 * half, ROUND_TITLE_H), GTextAlignmentCenter, s_accent);
    graphics_draw_line(ctx, GPoint(middle - ROUND_RULE_W / 2, ROUND_RULE_Y), GPoint(middle + ROUND_RULE_W / 2, ROUND_RULE_Y));
    draw_text(ctx, footer, FONT_KEY_GOTHIC_14, GRect(middle - foot_half, ROUND_FOOTER_Y, 2 * foot_half, NOTE_H + BOX_SLACK), GTextAlignmentCenter, GColorLightGray);

    int16_t body_half = half_width_at(bounds, ROUND_BODY_TOP, ROUND_BODY_BOTTOM);
    return GRect(middle - body_half, ROUND_BODY_TOP, 2 * body_half, ROUND_BODY_BOTTOM - ROUND_BODY_TOP);
#else
    int16_t width = bounds.size.w - 2 * RECT_INSET;
    GRect source = GRect(RECT_INSET, RECT_SOURCE_Y, width, NOTE_H + BOX_SLACK);

    draw_text(ctx, s_title, FONT_KEY_GOTHIC_18_BOLD, GRect(RECT_INSET, RECT_TITLE_Y, width, RECT_TITLE_H), GTextAlignmentLeft, s_accent);
    draw_text(ctx, s_age, FONT_KEY_GOTHIC_14, source, GTextAlignmentRight, GColorLightGray);
    // the age is short, so the plugin's name keeps clear of it however long the name runs
    source.size.w -= 4 * COLUMN_GAP;
    draw_text(ctx, plugin, FONT_KEY_GOTHIC_14, source, GTextAlignmentLeft, GColorLightGray);
    graphics_draw_line(ctx, GPoint(RECT_INSET, RECT_RULE_Y), GPoint(bounds.size.w - RECT_INSET, RECT_RULE_Y));

    return GRect(RECT_INSET, RECT_BODY_TOP, width, bounds.size.h - RECT_BODY_TOP - RECT_BODY_BOTTOM_GAP);
#endif
}

static void update_proc(Layer *layer, GContext *ctx)
{
    GRect bounds = layer_get_bounds(layer);
    GRect body = draw_frame(ctx, bounds);

    if (s_caption[0])
    {
        draw_message(ctx, body);
    }
    else
    {
        draw_lines(ctx, bounds, body);
    }
}

void screen_create(Window *window, const char *title, GColor accent, const ScreenStyle *style)
{
    Layer *root = window_get_root_layer(window);

    s_title = title;
    s_accent = accent;
    s_style = style;
    s_layer = layer_create(layer_get_bounds(root));
    layer_set_update_proc(s_layer, update_proc);
    layer_add_child(root, s_layer);
}

void screen_destroy(void)
{
    layer_destroy(s_layer);
    s_layer = NULL;
}

void screen_begin(const char *plugin, int age_s)
{
    s_count = 0;
    s_caption[0] = '\0';
    s_message[0] = '\0';
    copy(s_plugin, sizeof(s_plugin), plugin);
    screen_age_text(s_age, sizeof(s_age), age_s);
}

void screen_section(const char *name)
{
    Line *line = next_line(LINE_SECTION);

    if (line)
    {
        copy(line->label, sizeof(line->label), name);
    }
}

void screen_row(const char *label, const char *value)
{
    screen_row_aside(label, value, NULL);
}

void screen_row_aside(const char *label, const char *value, const char *aside)
{
    Line *line = next_line(LINE_ROW);

    if (line)
    {
        copy(line->label, sizeof(line->label), label);
        copy(line->value, sizeof(line->value), value);
        copy(line->aside, sizeof(line->aside), aside);
    }
}

void screen_note(const char *text)
{
    Line *line = next_line(LINE_NOTE);

    if (line)
    {
        copy(line->value, sizeof(line->value), text);
    }
}

void screen_message(const char *caption, const char *text)
{
    copy(s_caption, sizeof(s_caption), caption);
    copy(s_message, sizeof(s_message), text);
}

void screen_end(void)
{
    if (s_layer)
    {
        layer_mark_dirty(s_layer);
    }
}
