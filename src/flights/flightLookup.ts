/**
 * Looking a flight up, including one too old for the API to say anything about.
 *
 * The API answers for dates within a year either way, on every plan, and refuses
 * the rest: 400 for a 2018 ticket. But a scheduled flight runs on the same days each
 * week, so an old flight is looked up on a day near it that can be asked about, and
 * what comes back is moved onto its date. That gives it a route, a country and a
 * distance, which a passport needs. The times are another day's, so the flight says
 * so: its source is `nearby`, not `api`. The route is shown before it is saved, for
 * the case of a number that has since moved to another route.
 */

import type { FlightLookupPort } from './flightStatusApi';
import type { LookedUpFlight } from './types';
import { dateExists } from './ticketYear';
import { utcToLocal } from './zonedTime';

const DAY_MS = 24 * 3600 * 1000;
/** The API allows 365. One spare, since its day and ours may not be the same day. */
const RANGE_DAYS = 364;
/** Nearest first, earlier before later. */
const OFFSETS = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6];

const NOT_FOUND = '查不到這班航班，請手動填寫';

const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`);
const textOf = (day: number) => new Date(day).toISOString().slice(0, 10);
const today = (now: number) => Math.floor(now / DAY_MS) * DAY_MS;
const weekdayOf = (day: number) => new Date(day).getUTCDay();

export function isWithinLookup(date: string, now: number): boolean {
  return Math.abs(dayOf(date) - today(now)) <= RANGE_DAYS * DAY_MS;
}

/** The last time this month and day came round, by `latest`. */
function lastAnniversary(date: string, latest: number): number {
  const [, month, day] = date.split('-').map(Number);
  const thisYear = new Date(latest).getUTCFullYear();

  for (const year of [thisYear, thisYear - 1]) {
    // 29 February, in a year without one.
    const at = dateExists(year, month, day) ?? dateExists(year, month, day - 1);
    if (at !== null && at <= latest) return at;
  }
  return latest;
}

/**
 * Days to ask about in place of this one, best first. A timetable goes by the weekday
 * and by the season, so the same weekday near the same date this year comes first,
 * then the date itself, then the last time that weekday came round.
 */
export function standInDates(date: string, now: number): string[] {
  const wanted = weekdayOf(dayOf(date));
  const latest = today(now) - DAY_MS;
  const earliest = today(now) - RANGE_DAYS * DAY_MS;
  const reachable = (day: number) => day >= earliest && day <= latest;

  const anniversary = lastAnniversary(date, latest);
  const sameWeekdayNear = OFFSETS.map((offset) => anniversary + offset * DAY_MS).find(
    (day) => weekdayOf(day) === wanted && reachable(day),
  );
  const lastWeekday = OFFSETS.filter((offset) => offset <= 0)
    .map((offset) => latest + offset * DAY_MS)
    .concat(latest - 7 * DAY_MS)
    .find((day) => weekdayOf(day) === wanted);

  const days = [sameWeekdayNear, reachable(anniversary) ? anniversary : undefined, lastWeekday];
  return [...new Set(days.filter((day) => day !== undefined))].map(textOf);
}

/** That flight as it would have been on `date`, without what belongs to its own day. */
export function movedToDate(leg: LookedUpFlight, date: string): LookedUpFlight {
  const from = utcToLocal(leg.depScheduledUtc, leg.depTz).date;
  const shift = dayOf(date) - dayOf(from);

  return {
    ...leg,
    depScheduledUtc: leg.depScheduledUtc + shift,
    arrScheduledUtc: leg.arrScheduledUtc + shift,
    depTerminal: null,
    arrTerminal: null,
    depGate: null,
    arrGate: null,
    status: 'SCHEDULED',
    borrowed: true,
  };
}

export async function lookUpFlight(
  port: FlightLookupPort,
  flightNumber: string,
  date: string,
  now: number,
): Promise<{ legs: LookedUpFlight[]; notice: string | null }> {
  if (isWithinLookup(date, now)) {
    const legs = await port.findFlights(flightNumber, date);
    return { legs, notice: legs.length === 0 ? NOT_FOUND : null };
  }

  if (dayOf(date) > today(now)) {
    return { legs: [], notice: '只能查一年內的航班，請手動填寫' };
  }

  // One at a time: each costs, and the first answer is the best one.
  for (const standIn of standInDates(date, now)) {
    const legs = await port.findFlights(flightNumber, standIn);
    if (legs.length > 0) {
      return {
        legs: legs.map((leg) => movedToDate(leg, date)),
        notice: '日期太舊，航線和時間取自近期班次，請確認',
      };
    }
  }

  return { legs: [], notice: NOT_FOUND };
}
