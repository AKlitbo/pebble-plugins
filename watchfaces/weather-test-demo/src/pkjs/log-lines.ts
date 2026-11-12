/**
 * Log lines that `pebble logs` can read back whole.
 *
 * `pebble logs` cuts a long line at a byte limit, and a cut through the middle of a two byte character
 * crashed the whole capture. So every line goes out as plain ASCII, and a long one goes out as several
 * pieces, each short enough to stay whole.
 *
 * The three test faces keep the same copy of this file, since a paf unit only builds what sits inside
 * its own folder. A fix to one copy goes into the other two.
 */

/** The longest line the log writes, its tag included. */
export const LINE_MAX = 120;

/**
 * Turns a line into plain ASCII. A degree sign becomes `deg`, and anything else outside ASCII becomes
 * its `\u` code, so a cut line can never split a character in two.
 *
 * @param text The line to flatten.
 * @return The line in ASCII alone.
 */
export function asciiLine(text: string): string {
  return text.replace(/°/g, 'deg').replace(/[^\x20-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Splits a line into pieces no longer than LINE_MAX once the tag is on, breaking after a space where
 * there is one in the back half of the piece. Every piece after the first is marked with a plus, so it
 * reads as carrying on from the one before.
 *
 * @param name The face's name, which every line starts with in brackets.
 * @param body The line without its tag.
 * @return The lines to write, each with its tag.
 */
export function logLines(name: string, body: string): string[] {
  const first = `[${name}] `;
  const more = `[${name}]   + `;
  const lines: string[] = [];
  let rest = asciiLine(body);
  let prefix = first;

  while (prefix.length + rest.length > LINE_MAX) {
    const room = LINE_MAX - prefix.length;
    const space = rest.lastIndexOf(' ', room);
    const cut = space > room / 2 ? space + 1 : room;

    lines.push(prefix + rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut);
    prefix = more;
  }

  lines.push(prefix + rest);

  return lines;
}

/**
 * Makes the function a face writes its log with.
 *
 * @param name The face's name, which every line starts with in brackets.
 * @return A function that writes one line, in as many pieces as it takes.
 */
export function createLog(name: string): (body: string) => void {
  return (body) => {
    logLines(name, body).forEach((line) => console.log(line));
  };
}
