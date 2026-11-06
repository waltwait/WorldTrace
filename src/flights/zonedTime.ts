/**
 * Wall-clock time at an airport, to and from a UTC instant.
 *
 * A ticket prints every time in the local time of the airport it belongs to.
 * The phone's own zone has nothing to do with it: reading 07:30 TPE with
 * `new Date(...)` on a phone set to Taipei happens to work, and the same code
 * puts a Los Angeles arrival eight hours out. So every conversion here names
 * its zone, and uses that zone's offset on that date, not today's — a winter
 * flight booked in summer must not be an hour off.
 */

interface WallClock {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
}

const DATE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const TIME = /^(\d{1,2}):(\d{2})$/;

function parseWallClock(date: string, time: string): WallClock | null {
  const d = DATE.exec(date.trim());
  const t = TIME.exec(time.trim());
  if (!d || !t) return null;
  const [year, month, day, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  if (hour > 23 || minute > 59) return null;
  // Date.UTC rolls 30 February into March; a date that does not survive the
  // round trip does not exist.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

/** A date such as 2026-12-01 or 2026/12/1 that exists on the calendar. */
export function isValidDate(date: string): boolean {
  return parseWallClock(date, '00:00') !== null;
}

/** A time such as 07:30 or 7:30. */
export function isValidTime(time: string): boolean {
  return parseWallClock('2000-01-01', time) !== null;
}

function wallClockAt(utcMs: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMs));
  const p: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  // Some engines still say 24 for midnight even when asked for h23.
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute };
}

function offsetMinutes(timeZone: string, utcMs: number): number {
  const w = wallClockAt(utcMs, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const floored = Math.floor(utcMs / 60000) * 60000;
  return Math.round((asUtc - floored) / 60000);
}

/**
 * The instant at which the clocks in `timeZone` read `date` `time`.
 * Null for a date or time that does not exist, or a zone the engine does not
 * know — never a guess.
 */
export function localToUtc(date: string, time: string, timeZone: string): number | null {
  const w = parseWallClock(date, time);
  if (!w) return null;
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  try {
    // The offset depends on the instant, which is what we are solving for.
    // Take the offset at the naive guess, then check it at the result: they
    // differ only within hours of a daylight-saving change.
    const first = offsetMinutes(timeZone, guess);
    const result = guess - first * 60000;
    const second = offsetMinutes(timeZone, result);
    return second === first ? result : guess - second * 60000;
  } catch {
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** What the clocks in `timeZone` read at `utcMs`, as `YYYY-MM-DD` and `HH:MM`. */
export function utcToLocal(utcMs: number, timeZone: string): { date: string; time: string } {
  const w = wallClockAt(utcMs, timeZone);
  return {
    date: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}`,
  };
}

/**
 * A typed offset such as "+9", "-05" or "UTC+8", as an IANA zone, for an
 * airport the table does not know.
 *
 * Only whole hours: the fixed-offset zones IANA has (Etc/GMT-9 is UTC+9, the
 * sign reversed by POSIX convention) stop there, and rounding India's +5:30 to
 * an hour would put every time on that ticket half an hour out.
 */
export function offsetToZone(text: string): string | null {
  const m = /^(?:UTC|GMT)?\s*([+-]?)(\d{1,2})$/i.exec(text.trim());
  if (!m) return null;
  const hours = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  if (hours < -12 || hours > 14) return null;
  if (hours === 0) return 'Etc/UTC';
  return hours > 0 ? `Etc/GMT-${hours}` : `Etc/GMT+${-hours}`;
}
