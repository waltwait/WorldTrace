/**
 * Reading the recorded track back out.
 *
 * Shared by the exporter and the timeline: both want points grouped under the
 * outing they belong to, and both need to be able to ask for a slice of time.
 */

import type { TrackSegment } from '../export/gpx';
import type { SqlDriver, SqlValue } from './driver';

export interface TrackRange {
  /** Epoch milliseconds, inclusive. */
  from: number;
  /** Epoch milliseconds, inclusive. */
  to: number;
}

interface PointRow {
  segment_id: number;
  ts: number;
  lat: number;
  lon: number;
  altitude: number | null;
}

/**
 * Segments with their points, oldest first.
 *
 * Segments with no points inside the range are left out entirely — an outing
 * with nothing recorded is not something anyone wants to see listed.
 */
export async function loadTrack(
  driver: SqlDriver,
  range?: TrackRange,
): Promise<TrackSegment[]> {
  const where = range ? 'WHERE ts BETWEEN ? AND ?' : '';
  const params: SqlValue[] = range ? [range.from, range.to] : [];

  const rows = await driver.all<PointRow>(
    `SELECT segment_id, ts, lat, lon, altitude
       FROM points
       ${where}
      ORDER BY segment_id, ts`,
    params,
  );

  const segments: TrackSegment[] = [];
  let current: TrackSegment | null = null;

  for (const row of rows) {
    if (current === null || current.id !== row.segment_id) {
      current = { id: row.segment_id, points: [] };
      segments.push(current);
    }
    current.points.push({
      lat: row.lat,
      lon: row.lon,
      ts: row.ts,
      altitude: row.altitude,
    });
  }

  return segments;
}

export interface TrackDay {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Bounds that load exactly this day back through loadTrack. */
  from: number;
  to: number;
  pointCount: number;
}

/**
 * Days that have track, most recent first.
 *
 * Grouped by local date rather than UTC: a walk at 1 a.m. belongs to the night
 * it happened on, not to the previous day in a timezone the walker never
 * visited.
 */
export async function listDays(driver: SqlDriver): Promise<TrackDay[]> {
  const rows = await driver.all<{ date: string; from: number; to: number; pointCount: number }>(
    `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS date,
            MIN(ts) AS "from",
            MAX(ts) AS "to",
            COUNT(*) AS pointCount
       FROM points
      GROUP BY date
      ORDER BY date DESC`,
  );

  return rows;
}
