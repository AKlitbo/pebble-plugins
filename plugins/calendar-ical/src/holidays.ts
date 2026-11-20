/**
 * The public holiday calendars a feed can follow in place of an iCal link, shared by the settings page
 * and the plugin script.
 *
 * Each is one of Google's public holiday calendars, at an address Google does not document, so it can
 * change without notice. The calendar's id is a language and a country, such as
 * `en.usa#holiday@group.v.calendar.google.com`. The plain id carries the public holidays and the
 * observances, days such as Valentine's Day that are not days off. The id with `.official` after the
 * country carries the public holidays alone.
 *
 * The observances are left out by fetching the `.official` calendar rather than by reading each
 * event's description. The plain calendars mark a public holiday `Public holiday` in its description,
 * but for some countries, the United Kingdom and Australia among them, they mark every day an
 * observance, Christmas included, so a filter on the description would empty those feeds.
 *
 * Every calendar here, both forms, answered 200 to a fetch on 2026-11-19.
 */

/** One country's holiday calendar. */
export interface HolidayCalendar {
  /** The value the Country select saves. */
  id: string;
  /** The country, as the select shows it. */
  country: string;
  /** The name the feed takes until the wearer names it. */
  name: string;
  /** The country part of Google's calendar id, such as `usa` in `en.usa#holiday@group.v.calendar.google.com`. */
  google: string;
}

/** The countries, sorted by name, weighted to where Pebble wearers are. */
export const HOLIDAY_CALENDARS: readonly HolidayCalendar[] = [
  { id: 'ar', country: 'Argentina', name: 'Argentina Holidays', google: 'ar' },
  { id: 'au', country: 'Australia', name: 'Australia Holidays', google: 'australian' },
  { id: 'at', country: 'Austria', name: 'Austria Holidays', google: 'austrian' },
  { id: 'be', country: 'Belgium', name: 'Belgium Holidays', google: 'be' },
  { id: 'br', country: 'Brazil', name: 'Brazil Holidays', google: 'brazilian' },
  { id: 'ca', country: 'Canada', name: 'Canada Holidays', google: 'canadian' },
  { id: 'cz', country: 'Czechia', name: 'Czechia Holidays', google: 'czech' },
  { id: 'dk', country: 'Denmark', name: 'Denmark Holidays', google: 'danish' },
  { id: 'fi', country: 'Finland', name: 'Finland Holidays', google: 'finnish' },
  { id: 'fr', country: 'France', name: 'France Holidays', google: 'french' },
  { id: 'de', country: 'Germany', name: 'Germany Holidays', google: 'german' },
  { id: 'gr', country: 'Greece', name: 'Greece Holidays', google: 'greek' },
  { id: 'hk', country: 'Hong Kong', name: 'Hong Kong Holidays', google: 'hong_kong' },
  { id: 'hu', country: 'Hungary', name: 'Hungary Holidays', google: 'hungarian' },
  { id: 'is', country: 'Iceland', name: 'Iceland Holidays', google: 'is' },
  { id: 'in', country: 'India', name: 'India Holidays', google: 'indian' },
  { id: 'id', country: 'Indonesia', name: 'Indonesia Holidays', google: 'indonesian' },
  { id: 'ie', country: 'Ireland', name: 'Ireland Holidays', google: 'irish' },
  { id: 'it', country: 'Italy', name: 'Italy Holidays', google: 'italian' },
  { id: 'jp', country: 'Japan', name: 'Japan Holidays', google: 'japanese' },
  { id: 'lu', country: 'Luxembourg', name: 'Luxembourg Holidays', google: 'lu' },
  { id: 'my', country: 'Malaysia', name: 'Malaysia Holidays', google: 'malaysia' },
  { id: 'mx', country: 'Mexico', name: 'Mexico Holidays', google: 'mexican' },
  { id: 'nl', country: 'Netherlands', name: 'Netherlands Holidays', google: 'dutch' },
  { id: 'nz', country: 'New Zealand', name: 'New Zealand Holidays', google: 'new_zealand' },
  { id: 'no', country: 'Norway', name: 'Norway Holidays', google: 'norwegian' },
  { id: 'ph', country: 'Philippines', name: 'Philippines Holidays', google: 'philippines' },
  { id: 'pl', country: 'Poland', name: 'Poland Holidays', google: 'polish' },
  { id: 'pt', country: 'Portugal', name: 'Portugal Holidays', google: 'portuguese' },
  { id: 'sg', country: 'Singapore', name: 'Singapore Holidays', google: 'singapore' },
  { id: 'za', country: 'South Africa', name: 'South Africa Holidays', google: 'sa' },
  { id: 'kr', country: 'South Korea', name: 'South Korea Holidays', google: 'south_korea' },
  { id: 'es', country: 'Spain', name: 'Spain Holidays', google: 'spain' },
  { id: 'se', country: 'Sweden', name: 'Sweden Holidays', google: 'swedish' },
  { id: 'ch', country: 'Switzerland', name: 'Switzerland Holidays', google: 'ch' },
  { id: 'tw', country: 'Taiwan', name: 'Taiwan Holidays', google: 'taiwan' },
  { id: 'gb', country: 'United Kingdom', name: 'UK Holidays', google: 'uk' },
  { id: 'us', country: 'United States', name: 'US Holidays', google: 'usa' },
];

/**
 * The names a feed's Name can hold and still count as filled in for the wearer: the feed's own default
 * and every country's holiday name. The settings page and the plugin both go by this list, so a name
 * the page filled in for one country is never served under another.
 *
 * @param defaultName The feed's own default name, such as `Feed 1`.
 * @return The names, the default first.
 */
export function automaticNames(defaultName: string): string[] {
  const names = [defaultName];

  for (const calendar of HOLIDAY_CALENDARS) {
    names.push(calendar.name);
  }

  return names;
}

/**
 * Whether a feed's saved Name was filled in rather than typed: empty, the feed's default, or any
 * country's holiday name.
 *
 * @param name The saved Name.
 * @param defaultName The feed's own default name.
 * @return True for a name the feed can replace with its country's.
 */
export function isAutomaticName(name: string, defaultName: string): boolean {
  const trimmed = name.trim();

  return !trimmed || automaticNames(defaultName).includes(trimmed);
}

/** The country the Country select opens on. */
export const DEFAULT_COUNTRY = 'us';

/**
 * A country's holiday calendar, from the saved Country.
 *
 * @param id The saved Country.
 * @return Its calendar, or the United States' for anything that is not one of the countries.
 */
export function holidayCalendar(id: unknown): HolidayCalendar {
  return HOLIDAY_CALENDARS.find((calendar) => calendar.id === id) || (HOLIDAY_CALENDARS.find((calendar) => calendar.id === DEFAULT_COUNTRY) as HolidayCalendar);
}

/**
 * The link a holiday feed fetches. It is built from the country each run rather than saved, and it is
 * not secret, since every wearer in a country fetches the same one.
 *
 * @param calendar The country's calendar.
 * @param observances Whether the observances come too, rather than the public holidays alone.
 * @return The calendar's iCal link.
 */
export function holidayLink(calendar: HolidayCalendar, observances: boolean): string {
  const id = `en.${calendar.google}${observances ? '' : '.official'}#holiday@group.v.calendar.google.com`;

  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;
}
