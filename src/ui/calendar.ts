/**
 * The month grid behind the date picker.
 *
 * Dates here are plain 'YYYY-MM-DD' text, the same as the form holds: a flight's
 * date belongs to its airport, so nothing here goes through a time zone.
 */

export interface Month {
  year: number;
  /** 1 to 12. */
  month: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Enough for any month, so that every month is the same height on the screen. */
const WEEKS_SHOWN = 6;

/** A month as six weeks of seven, Sunday first, with null for the days around it. */
export function monthWeeks({ year, month }: Month): Array<Array<string | null>> {
  const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= length; day += 1) {
    cells.push(`${year}-${pad(month)}-${pad(day)}`);
  }
  while (cells.length < WEEKS_SHOWN * 7) cells.push(null);

  return Array.from({ length: WEEKS_SHOWN }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

export function shiftMonth({ year, month }: Month, by: number): Month {
  const months = year * 12 + (month - 1) + by;
  return { year: Math.floor(months / 12), month: (months % 12) + 1 };
}

function realDate(text: string): (Month & { day: number }) | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;

  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day } : null;
}

/** The month to open on: the chosen date's, or today's if the box holds no real date. */
export function monthOf(text: string, today: Date): Month {
  const date = realDate(text);
  return date
    ? { year: date.year, month: date.month }
    : { year: today.getFullYear(), month: today.getMonth() + 1 };
}

/**
 * The same day in another year. A ticket prints no year, so the day is usually right
 * and the year is all that needs changing.
 */
export function withYear(text: string, year: number): string | null {
  const date = realDate(text);
  if (!date) return null;

  const lastDay = new Date(Date.UTC(year, date.month, 0)).getUTCDate();
  return `${year}-${pad(date.month)}-${pad(Math.min(date.day, lastDay))}`;
}

/** Today by the phone's clock, which is the day the person holding it means. */
export function todayString(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const YEARS_PER_PAGE = 12;

/** The page of years holding this one, so a trip years back is a few taps away. */
export function yearPage(year: number): number[] {
  const first = year - (year % YEARS_PER_PAGE);
  return Array.from({ length: YEARS_PER_PAGE }, (_, index) => first + index);
}
