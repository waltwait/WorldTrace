/**
 * The numbers behind the harder achievements.
 *
 * These all answer "what was the best you ever did" rather than "how much in
 * total", which is what the plain summary already covers. A total only ever
 * goes up, so a total-based badge is a matter of waiting; these ones have to be
 * gone out and earned.
 *
 * Every one is derived from the track on read. Nothing here is stored, so a
 * threshold can be changed without leaving anybody holding a badge the rules no
 * longer grant.
 */

import { distanceMeters } from '../geo/distance';
import type { SqlDriver } from './driver';
import { getPointsSignature, type PointsSignature } from './stats';

export interface Milestones {
  /** Longest run of consecutive days with any track at all. */
  longestStreakDays: number;
  /** Distance covered on the single busiest day. */
  maxDayDistanceMeters: number;
  /** Distance covered in the single longest unbroken segment. */
  longestOutingMeters: number;
  /** How far from the very first recorded fix you have ever got. */
  farthestFromStartMeters: number;
  /** Days with a fix between midnight and 05:00. */
  nightDayCount: number;
  /** Days with a fix between 05:00 and 07:00. */
  dawnDayCount: number;
}

interface PointRow {
  segment_id: number;
  ts: number;
  lat: number;
  lon: number;
}

const EMPTY: Milestones = {
  longestStreakDays: 0,
  maxDayDistanceMeters: 0,
  longestOutingMeters: 0,
  farthestFromStartMeters: 0,
  nightDayCount: 0,
  dawnDayCount: 0,
};

const NIGHT_ENDS_AT_HOUR = 5;
const DAWN_ENDS_AT_HOUR = 7;

function toLocalDayAndHour(ts: number): { day: string; hour: number } {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return {
    day: `${year}-${month}-${day}`,
    hour: d.getHours(),
  };
}

const milestonesCache = new WeakMap<SqlDriver, { sig: PointsSignature; milestones: Milestones }>();

export async function buildMilestones(
  driver: SqlDriver,
  knownSig?: PointsSignature,
): Promise<Milestones> {
  const sig = knownSig ?? (await getPointsSignature(driver));
  const cached = milestonesCache.get(driver);
  if (cached && cached.sig.count === sig.count && cached.sig.lastTs === sig.lastTs) {
    return cached.milestones;
  }

  const points = await driver.all<PointRow>(
    `SELECT segment_id, ts, lat, lon
       FROM points
      ORDER BY ts`,
  );

  if (points.length === 0) {
    milestonesCache.set(driver, { sig, milestones: { ...EMPTY } });
    return { ...EMPTY };
  }

  const start = points[0];
  const perDay = new Map<string, number>();
  const perSegment = new Map<number, number>();
  const nights = new Set<string>();
  const dawns = new Set<string>();

  let farthestFromStartMeters = 0;

  const allDays = new Set<string>();
  const lastInSegment = new Map<number, { point: PointRow; day: string }>();

  for (const point of points) {
    const { day, hour } = toLocalDayAndHour(point.ts);
    allDays.add(day);

    if (hour < NIGHT_ENDS_AT_HOUR) nights.add(day);
    else if (hour < DAWN_ENDS_AT_HOUR) dawns.add(day);

    farthestFromStartMeters = Math.max(farthestFromStartMeters, distanceMeters(start, point));

    const previous = lastInSegment.get(point.segment_id);
    lastInSegment.set(point.segment_id, { point, day });
    if (previous === undefined) continue;

    const leg = distanceMeters(previous.point, point);
    perSegment.set(point.segment_id, (perSegment.get(point.segment_id) ?? 0) + leg);

    // A leg that crosses midnight belongs to neither day: it is a phone that
    // was asleep, not a walk, and charging it to either day would invent a
    // record nobody set.
    if (previous.day === day) {
      perDay.set(day, (perDay.get(day) ?? 0) + leg);
    }
  }

  const result: Milestones = {
    longestStreakDays: longestStreak([...allDays]),
    maxDayDistanceMeters: largest(perDay.values()),
    longestOutingMeters: largest(perSegment.values()),
    farthestFromStartMeters,
    nightDayCount: nights.size,
    dawnDayCount: dawns.size,
  };

  milestonesCache.set(driver, { sig, milestones: result });
  return result;
}

function largest(values: Iterable<number>): number {
  let best = 0;
  for (const value of values) best = Math.max(best, value);
  return best;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The longest run of consecutive dates in a list of 'YYYY-MM-DD' strings.
 *
 * Parsed as UTC midnight so that the difference between two dates is always a
 * whole number of days — a local-time parse would be an hour out across a
 * daylight-saving boundary and quietly break the run.
 */
function longestStreak(days: string[]): number {
  if (days.length === 0) return 0;

  const sorted = [...days].sort();
  let longest = 1;
  let current = 1;

  for (let index = 1; index < sorted.length; index++) {
    const gap = Date.parse(`${sorted[index]}T00:00:00Z`) - Date.parse(`${sorted[index - 1]}T00:00:00Z`);

    current = gap === ONE_DAY_MS ? current + 1 : 1;
    longest = Math.max(longest, current);
  }

  return longest;
}
