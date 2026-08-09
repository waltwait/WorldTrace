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
  day: string;
  hour: number;
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

export async function buildMilestones(driver: SqlDriver): Promise<Milestones> {
  // The local day and hour are resolved by SQLite rather than by JS Date, so
  // they agree with the day grouping the timeline and the summary already use.
  const points = await driver.all<PointRow>(
    `SELECT segment_id, ts, lat, lon,
            date(ts / 1000, 'unixepoch', 'localtime')            AS day,
            CAST(strftime('%H', ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour
       FROM points
      ORDER BY ts`,
  );

  if (points.length === 0) return { ...EMPTY };

  const start = points[0];
  const perDay = new Map<string, number>();
  const perSegment = new Map<number, number>();
  const nights = new Set<string>();
  const dawns = new Set<string>();

  let farthestFromStartMeters = 0;

  // Legs are measured against the previous point in the same segment. Ordering
  // by ts alone would interleave two segments that overlap in time, so the
  // previous point is tracked per segment rather than globally.
  const lastInSegment = new Map<number, PointRow>();

  for (const point of points) {
    if (point.hour < NIGHT_ENDS_AT_HOUR) nights.add(point.day);
    else if (point.hour < DAWN_ENDS_AT_HOUR) dawns.add(point.day);

    farthestFromStartMeters = Math.max(farthestFromStartMeters, distanceMeters(start, point));

    const previous = lastInSegment.get(point.segment_id);
    lastInSegment.set(point.segment_id, point);
    if (previous === undefined) continue;

    const leg = distanceMeters(previous, point);
    perSegment.set(point.segment_id, (perSegment.get(point.segment_id) ?? 0) + leg);

    // A leg that crosses midnight belongs to neither day: it is a phone that
    // was asleep, not a walk, and charging it to either day would invent a
    // record nobody set.
    if (previous.day === point.day) {
      perDay.set(point.day, (perDay.get(point.day) ?? 0) + leg);
    }
  }

  return {
    longestStreakDays: longestStreak([...new Set(points.map((point) => point.day))]),
    maxDayDistanceMeters: largest(perDay.values()),
    longestOutingMeters: largest(perSegment.values()),
    farthestFromStartMeters,
    nightDayCount: nights.size,
    dawnDayCount: dawns.size,
  };
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
