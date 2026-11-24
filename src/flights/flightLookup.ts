/**
 * Looking a flight up, including one whose date the API has nothing on.
 *
 * The API answers for dates within a year either way, on every plan, and refuses
 * the rest: 400 for a 2018 ticket. Future timetables can also have gaps — CX500 had
 * Wednesday on file for one week and returned 204 for the Thursday of a sold ticket.
 * Because a scheduled flight runs on a weekly/seasonal pattern, a missing or too-old
 * date is looked up on a nearby day the API does have, and moved onto its own date.
 * That gives it a route, a country and a distance, which a passport needs. The times
 * are another day's, so the flight says so: its source is `nearby`, not `api`, and
 * the route is shown before it is saved.
 */

import type { FlightLookupPort } from './flightStatusApi';
import type { LookedUpFlight } from './types';
import { dateExists } from './ticketYear';
import { localToUtc, utcToLocal } from './zonedTime';

const DAY_MS = 24 * 3600 * 1000;
/** The API allows 365. One spare, since its day and ours may not be the same day. */
const RANGE_DAYS = 364;
/** Nearest first, earlier before later. */
const OFFSETS = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6];
const HALF_A_YEAR_DAYS = 182;
/** Within four weeks, a timetable belongs to the same seasonal schedule. */
const NEAR_TIMETABLE_DAYS = 28;

const NOT_FOUND = '查不到這班航班，請手動填寫';
// Said instead of borrowing another day: a failed request knows nothing of the flight.
const NO_ANSWER = '連不上航班資料，請稍後再試';
const BORROWED_OLD = '日期太舊，航線和時間取自近期班次，請確認';
const BORROWED_NEARBY = '查不到當日班表，航線和時間取自鄰近班次，請確認';

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

  // A number that has since stopped flying, as TR898 did, is only to be found early on.
  const firstWeekday = OFFSETS.filter((offset) => offset >= 0)
    .map((offset) => earliest + offset * DAY_MS)
    .find((day) => weekdayOf(day) === wanted);
  const halfway = OFFSETS.map((offset) => today(now) - HALF_A_YEAR_DAYS * DAY_MS + offset * DAY_MS).find(
    (day) => weekdayOf(day) === wanted && reachable(day),
  );

  const days = [
    sameWeekdayNear,
    reachable(anniversary) ? anniversary : undefined,
    lastWeekday,
    firstWeekday,
    halfway,
  ];
  return [...new Set(days.filter((day) => day !== undefined))].map(textOf);
}

/**
 * The best of the days a number is known to have flown: the same weekday nearest the
 * same date this year, or failing that the nearest at all. Only a day already past
 * and still within reach.
 */
export function bestFlownDate(flown: readonly string[], date: string, now: number): string | null {
  const latest = today(now) - DAY_MS;
  const earliest = today(now) - RANGE_DAYS * DAY_MS;
  const anniversary = lastAnniversary(date, latest);
  const wanted = weekdayOf(dayOf(date));

  const days = flown
    .map(dayOf)
    .filter((day) => day >= earliest && day <= latest)
    .sort((a, b) => Math.abs(a - anniversary) - Math.abs(b - anniversary));
  const best = days.find((day) => weekdayOf(day) === wanted) ?? days[0];
  return best === undefined ? null : textOf(best);
}

/**
 * `utcMs` on the clocks of `timeZone`, moved `days` calendar days. A timetable
 * is in local time, so the time of day stays and the instant follows: adding
 * days of 24 hours instead moved the clock by an hour across a daylight-saving
 * change, and an 00:30 departure onto the day before.
 */
function sameClockDaysLater(utcMs: number, timeZone: string, days: number): number {
  const { date, time } = utcToLocal(utcMs, timeZone);
  const moved = new Date(dayOf(date) + days * DAY_MS).toISOString().slice(0, 10);
  // Null only for a time the clocks skip that day; then the plain shift will do.
  return localToUtc(moved, time, timeZone) ?? utcMs + days * DAY_MS;
}

/** That flight as it would have been on `date`, without what belongs to its own day. */
export function movedToDate(leg: LookedUpFlight, date: string): LookedUpFlight {
  const from = utcToLocal(leg.depScheduledUtc, leg.depTz).date;
  const days = Math.round((dayOf(date) - dayOf(from)) / DAY_MS);

  return {
    ...leg,
    depScheduledUtc: sameClockDaysLater(leg.depScheduledUtc, leg.depTz, days),
    arrScheduledUtc: sameClockDaysLater(leg.arrScheduledUtc, leg.arrTz, days),
    depTerminal: null,
    arrTerminal: null,
    depGate: null,
    arrGate: null,
    status: 'SCHEDULED',
    borrowed: true,
  };
}

/**
 * Stand-in dates for an in-range date that returned 204 on its own day.
 *
 * When `/dates` lists days within four weeks of `date`, the same weekday there comes
 * first and the closest day there second (for a Thursday with only the Wednesday before
 * on file, that Wednesday). When `/dates` only indexes past flights, a future lookup tries the
 * day before `date` once in case the static schedule has it, then `bestFlownDate`.
 */
function inRangeStandIns(
  known: readonly string[] | null,
  date: string,
  now: number,
): string[] {
  if (known !== null && known.length === 0) return [];

  const target = dayOf(date);
  const todayMs = today(now);
  const wanted = weekdayOf(target);
  const inFuture = target > todayMs;

  if (known === null) {
    if (!inFuture) return [];
    const adjacent = [-1, 1]
      .map((offset) => target + offset * DAY_MS)
      .filter((day) => day > todayMs)
      .map(textOf)
      .filter((d) => isWithinLookup(d, now));
    return [...new Set([...adjacent, ...standInDates(date, now).slice(0, 3)])];
  }

  const reachable = known
    .filter((d) => d !== date && isWithinLookup(d, now))
    .map(dayOf)
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
  const near = reachable.filter((d) => Math.abs(d - target) <= NEAR_TIMETABLE_DAYS * DAY_MS);
  const flown = bestFlownDate(known, date, now);
  const fallback = reachable.find((d) => weekdayOf(d) === wanted) ?? reachable[0];

  if (near.length > 0) {
    const sameWeekdayNear = near.find((d) => weekdayOf(d) === wanted);
    const picks = [sameWeekdayNear, near[0], flown ? dayOf(flown) : undefined, fallback];
    return [...new Set(picks.filter((d) => d !== undefined))].map(textOf);
  }

  const dayBefore =
    inFuture && target - DAY_MS > todayMs && isWithinLookup(textOf(target - DAY_MS), now)
      ? textOf(target - DAY_MS)
      : undefined;
  const picks = [dayBefore, flown ?? undefined, fallback !== undefined ? textOf(fallback) : undefined];
  return [...new Set(picks.filter((d): d is string => d !== undefined && d !== date))];
}

async function firstFoundOn(
  port: FlightLookupPort,
  flightNumber: string,
  tries: readonly string[],
  targetDate: string,
  notice: string,
): Promise<{ legs: LookedUpFlight[]; notice: string | null }> {
  // One at a time: each costs, and the first answer is the best one.
  for (const standIn of tries) {
    const legs = await port.findFlights(flightNumber, standIn);
    if (legs === null) return { legs: [], notice: NO_ANSWER };
    if (legs.length > 0) {
      return {
        legs: legs.map((leg) => movedToDate(leg, targetDate)),
        notice,
      };
    }
  }
  return { legs: [], notice: NOT_FOUND };
}

export async function lookUpFlight(
  port: FlightLookupPort,
  flightNumber: string,
  date: string,
  now: number,
): Promise<{ legs: LookedUpFlight[]; notice: string | null }> {
  if (isWithinLookup(date, now)) {
    const legs = await port.findFlights(flightNumber, date);
    if (legs === null) return { legs: [], notice: NO_ANSWER };
    if (legs.length > 0) return { legs, notice: null };

    const known = (await port.flightDates?.(flightNumber)) ?? null;
    const tries = inRangeStandIns(known, date, now);
    if (tries.length === 0) return { legs: [], notice: NOT_FOUND };
    return firstFoundOn(port, flightNumber, tries, date, BORROWED_NEARBY);
  }

  if (dayOf(date) > today(now)) {
    return { legs: [], notice: '只能查一年內的航班，請手動填寫' };
  }

  // Which days it really flew, when the API will say, beats any guess: a number can
  // stop flying, as TR898 did, or fly only in a season. Each try costs 2 units.
  const flown = (await port.flightDates?.(flightNumber)) ?? null;
  if (flown !== null && flown.length === 0) return { legs: [], notice: NOT_FOUND };

  const best = flown ? bestFlownDate(flown, date, now) : null;
  const tries = [...new Set([...(best ? [best] : []), ...standInDates(date, now)])];
  return firstFoundOn(port, flightNumber, tries, date, BORROWED_OLD);
}
