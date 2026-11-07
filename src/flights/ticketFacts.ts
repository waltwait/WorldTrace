/**
 * The flight number, date, time and seat, out of the text on a ticket.
 *
 * That is all that is ever taken. A flight number and a date are enough to look
 * up the rest, so nothing else on a ticket has to be read, kept or sent: not the
 * booking code, not the name, not the barcode, which holds both. The text comes
 * from recognition on the phone (see readTicket.ts), and the picture never
 * leaves it. Everything here is plain string work so it runs under test against
 * what recognition really gives back, including the handwriting on the paper
 * behind a boarding pass.
 */

import { cleanFlightNumber } from './flightNumber';
import { dateExists, yearFor, type TicketKind } from './ticketYear';

export interface TicketFacts {
  flightNumber: string;
  /** `YYYY-MM-DD`, on the clocks at the departure airport. */
  date: string | null;
  /** `HH:MM`, likewise. */
  time: string | null;
  seat: string | null;
  /** The ticket printed no year and no weekday, so the date's year is a guess. */
  yearGuessed: boolean;
}

// A two-character airline code with a letter in it, then three or four digits.
// As one word it can be in any case; with a space only in capitals, or "at 0730"
// would be a flight. Having to have a letter is what keeps "01 2026" out.
const JOINED_NUMBER = /\b([A-Z][A-Z0-9]|[0-9][A-Z])([0-9]{3,4})\b/i;
const SPACED_NUMBER = /\b([A-Z][A-Z0-9]|[0-9][A-Z])\s+([0-9]{3,4})\b/;
const NOT_AN_AIRLINE = /^(AT|ON|TO|IN|NO|OF|BY|OR|IS|IT|AS|BE|GO|UP|US|WE|DO|SO)$/;

function flightNumberIn(line: string): string | null {
  const misread = MISREAD_NUMBER.exec(line);
  if (misread && /\d/.test(misread[2])) {
    return cleanFlightNumber(`${misread[1]}${misread[2].replace(/O/gi, '0')}`);
  }

  const joined = JOINED_NUMBER.exec(line);
  if (joined) return cleanFlightNumber(`${joined[1]}${joined[2]}`);
  const spaced = SPACED_NUMBER.exec(line);
  return spaced && !NOT_AN_AIRLINE.test(spaced[1])
    ? cleanFlightNumber(`${spaced[1]}${spaced[2]}`)
    : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';
// BRO117/21JUN: a paper pass joins the flight to its date, and ML Kit reads the zero
// of its padding as the letter O, the slash now and then as a bar. Only with the date
// behind it: a booking code is letters and digits as well, and is never to be read.
const MISREAD_NUMBER = new RegExp(`\\b([A-Z][A-Z0-9])([0-9O]{3,4})\\s*[/|]\\s*\\d{1,2}\\s*(?:${MONTH})`, 'i');
const WHOLE_DATE = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/;
const CHINESE_DATE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
// "12JUL", "03 Mar", "31 Dec 2026", "31DEC26". The look-ahead keeps "03 Mar 15:25"
// from reading the hour as a year.
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})\\s*(${MONTH})[A-Z]*\\.?(?:\\s*,?\\s*(\\d{4}|\\d{2})(?![:\\d]))?`, 'i');
const MONTH_DAY = new RegExp(`\\b(${MONTH})[A-Z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, 'i');

const ENGLISH_WEEKDAY = /\b(MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*\b/i;
const CHINESE_WEEKDAY = /(?:週|周|星期)([日一二三四五六])/;
const CHINESE_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function weekdayIn(line: string): string | null {
  const english = ENGLISH_WEEKDAY.exec(line);
  if (english) return english[1];
  const chinese = CHINESE_WEEKDAY.exec(line);
  return chinese ? CHINESE_WEEKDAYS['日一二三四五六'.indexOf(chinese[1])] : null;
}

interface PrintedDate {
  year: number | null;
  month: number;
  day: number;
}

function printedDateIn(line: string): PrintedDate | null {
  const whole = WHOLE_DATE.exec(line);
  if (whole) return { year: Number(whole[1]), month: Number(whole[2]), day: Number(whole[3]) };

  const chinese = CHINESE_DATE.exec(line);
  if (chinese) {
    return {
      year: chinese[1] ? Number(chinese[1]) : null,
      month: Number(chinese[2]),
      day: Number(chinese[3]),
    };
  }

  const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const fullYear = (text: string | undefined) => {
    if (!text) return null;
    return text.length === 2 ? 2000 + Number(text) : Number(text);
  };

  const dayMonth = DAY_MONTH.exec(line);
  if (dayMonth) {
    return { year: fullYear(dayMonth[3]), month: monthOf(dayMonth[2]), day: Number(dayMonth[1]) };
  }

  const monthDay = MONTH_DAY.exec(line);
  if (monthDay) {
    return { year: fullYear(monthDay[3]), month: monthOf(monthDay[1]), day: Number(monthDay[2]) };
  }

  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function findDate(
  lines: readonly string[],
  now: number,
  kind: TicketKind | undefined,
): { date: string; guessed: boolean } | null {
  for (const line of lines) {
    const printed = printedDateIn(line);
    if (!printed) continue;

    const { month, day } = printed;
    const found =
      printed.year === null
        ? yearFor(month, day, weekdayIn(line), now, kind)
        : { year: dateExists(printed.year, month, day) === null ? null : printed.year, guessed: false };

    if (found.year !== null) {
      return { date: `${found.year}-${pad(month)}-${pad(day)}`, guessed: found.guessed };
    }
  }
  return null;
}

const CLOCK = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const COMPACT_TIME = /\b([01]\d|2[0-3])[:.]?([0-5]\d)\b/;
const ONLY_A_TIME = /^([01]\d|2[0-3])[:.]?([0-5]\d)$/;
const DEPARTURE_LABEL = /DEPARTURE\s*TIME|起飛時間/i;

function findTime(lines: readonly string[], kind: TicketKind): string | null {
  // A boarding pass prints 1040 with no colon, beside a boarding time just like
  // it, so there it is only taken from under its own label.
  for (let i = 0; i < lines.length; i++) {
    const label = DEPARTURE_LABEL.exec(lines[i]);
    if (!label) continue;

    const after = lines[i].slice(label.index + label[0].length);
    const match = COMPACT_TIME.exec(after) ?? ONLY_A_TIME.exec(lines[i + 1] ?? '');
    if (match) return `${pad(Number(match[1]))}:${match[2]}`;
  }

  // A lone time on a boarding pass is when boarding opens, and may have a pen
  // through it. The flight has a real time, and the lookup knows it.
  if (kind === 'ticket') return null;

  // Otherwise only a time that is the only one. A mail prints the departure and
  // the arrival, and recognition's blocks come back in no order to rely on: on
  // the phone the arrival came first. The lookup has the real ones.
  const times = new Set(
    lines.flatMap((line) => {
      const clock = CLOCK.exec(line);
      return clock ? [`${pad(Number(clock[1]))}:${clock[2]}`] : [];
    }),
  );
  return times.size === 1 ? [...times][0] : null;
}

const SEAT_LABEL = /\bSEAT\b|座位|座號/i;
const SEAT = /\b([1-9]\d?[A-K])\b/;
const ONLY_A_SEAT = /^[1-9]\d?[A-K]$/;

function findSeat(lines: readonly string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const label = SEAT_LABEL.exec(lines[i]);
    if (!label) continue;

    const after = lines[i].slice(label.index + label[0].length);
    const match = SEAT.exec(after) ?? SEAT.exec(lines[i + 1] ?? '') ?? SEAT.exec(lines[i + 2] ?? '');
    if (match) return match[1];
  }

  // A table is read a column or a row at a time, so the value can land far from
  // its label; a line that is nothing else is still the seat.
  return lines.some((line) => SEAT_LABEL.test(line))
    ? (lines.find((line) => ONLY_A_SEAT.test(line)) ?? null)
    : null;
}

// Loose on purpose: recognition read "BOARDING TOMET", and the year a ticket was
// guessed to be in went a year out with it. Only a boarding pass prints a gate.
const BOARDING_PASS = /BOARDING|登機|\bGATE\b/i;

/**
 * Every flight on a ticket, in the order printed. With several, each takes the
 * date, time and seat printed after its number and before the next one. A number
 * printed twice, as on the stub of a boarding pass, is still one flight.
 */
export function extractTickets(blocks: readonly string[], now: number): TicketFacts[] {
  const lines = blocks
    .flatMap((block) => block.split('\n'))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const kind: TicketKind = lines.some((line) => BOARDING_PASS.test(line)) ? 'ticket' : 'mail';

  const starts: Array<{ index: number; flightNumber: string }> = [];
  lines.forEach((line, index) => {
    const flightNumber = flightNumberIn(line);
    if (flightNumber && !starts.some((s) => s.flightNumber === flightNumber)) {
      starts.push({ index, flightNumber });
    }
  });

  const read = starts.map(({ index, flightNumber }, i) => {
    const own = lines.slice(index, starts[i + 1]?.index ?? lines.length);
    return { flightNumber, own, ownDate: findDate(own, now, kind) };
  });

  // A real flight is printed with its date. What only looks like one, such as
  // the printing on the paper behind a boarding pass, has none of its own.
  const dated = read.filter((r) => r.ownDate !== null);
  const flights = dated.length > 0 ? dated : read;

  return flights.map(({ flightNumber, own, ownDate }) => {
    const found = ownDate ?? findDate(lines, now, kind);
    // Recognition's blocks come back in no order to rely on, so with one flight
    // the whole ticket is its own. The date is the exception: a mail's sent date
    // can sit above the flight, so the one printed after it goes first.
    const whole = flights.length === 1 ? lines : own;
    return {
      flightNumber,
      date: found?.date ?? null,
      time: findTime(whole, kind),
      seat: findSeat(whole),
      yearGuessed: found?.guessed ?? false,
    };
  });
}
