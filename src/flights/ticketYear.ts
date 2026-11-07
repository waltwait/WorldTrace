/**
 * The year a ticket did not print.
 *
 * Booking mails and boarding passes both print "03 Mar" and "12JUL". A printed
 * weekday settles it, since a date only falls on that weekday in one of the
 * years around now. Without one it is a guess, marked as a guess, for the form
 * to ask about: a boarding pass is printed at check-in, so it is the last time
 * that date came round; anything else is the next time.
 */

/** The two ways a ticket reaches the app, which differ in what a date means. */
export type TicketKind = 'mail' | 'ticket';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_MS = 24 * 3600 * 1000;

/** Midnight UTC on that date, or null if it does not exist that year. */
export function dateExists(year: number, month: number, day: number): number | null {
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? at.getTime() : null;
}

export function yearFor(
  month: number,
  day: number,
  weekday: string | null | undefined,
  now: number,
  kind?: TicketKind,
): { year: number | null; guessed: boolean } {
  const thisYear = new Date(now).getUTCFullYear();
  const dates = [thisYear - 1, thisYear, thisYear + 1].flatMap((year) => {
    const at = dateExists(year, month, day);
    return at === null ? [] : [{ year, at }];
  });
  if (dates.length === 0) return { year: null, guessed: false };

  const wanted = WEEKDAYS.indexOf((weekday ?? '').trim().slice(0, 3).toLowerCase());
  const fits = dates.filter((d) => new Date(d.at).getUTCDay() === wanted);
  if (fits.length === 1) return { year: fits[0].year, guessed: false };

  const today = Math.floor(now / DAY_MS) * DAY_MS;
  // Tomorrow counts as passed: the date printed is the airport's, not the phone's.
  const passed = dates.filter((d) => d.at <= today + DAY_MS);
  const pick =
    kind === 'ticket' ? passed[passed.length - 1] : dates.find((d) => d.at >= today);
  return { year: (pick ?? dates[dates.length - 1]).year, guessed: true };
}
