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

import { getPointsSignature, type PointsSignature } from './stats';

const daysCache = new WeakMap<SqlDriver, { sig: PointsSignature; days: TrackDay[] }>();
let globalCachedDays: TrackDay[] | null = null;

export function getCachedDays(): TrackDay[] | null {
  return globalCachedDays;
}

/**
 * Days that have track, most recent first.
 *
 * Grouped by local date rather than UTC: a walk at 1 a.m. belongs to the night
 * it happened on, not to the previous day in a timezone the walker never
 * visited.
 */
export async function listDays(
  driver: SqlDriver,
  knownSig?: PointsSignature,
): Promise<TrackDay[]> {
  const sig = knownSig ?? (await getPointsSignature(driver));
  const cached = daysCache.get(driver);
  if (cached && cached.sig.count === sig.count && cached.sig.lastTs === sig.lastTs) {
    return cached.days;
  }

  const rows = await driver.all<{ date: string; from: number; to: number; pointCount: number }>(
    `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS date,
            MIN(ts) AS "from",
            MAX(ts) AS "to",
            COUNT(*) AS pointCount
       FROM points
      GROUP BY date
      ORDER BY date DESC`,
  );

  daysCache.set(driver, { sig, days: rows });
  globalCachedDays = rows;
  return rows;
}

export interface OverviewTrackFeature {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: {
    type: 'MultiLineString';
    coordinates: [number, number][][];
  };
}

/**
 * Fast approximate squared distance in meters between two lon/lat points.
 */
function distanceMetersSq(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const avgLatRad = ((lat1 + lat2) * Math.PI) / 360;
  const dLon = (lon2 - lon1) * 111320 * Math.cos(avgLatRad);
  return dLat * dLat + dLon * dLon;
}

const MIN_OVERVIEW_STEP_METERS_SQ = 10 * 10; // 100 m^2

/**
 * Loads all historical track points as an overview MultiLineString GeoJSON feature.
 *
 * Designed for low-to-medium zoom level overview rendering:
 * - Reads only lightweight `(segment_id, lon, lat)` sorted by segment and time.
 * - Applies a 10-meter radial downsampling to collapse dense walking fixes into
 *   smooth, lightweight vector lines without losing macroscopic path fidelity.
 * - Filters out single-point segments (a line needs at least 2 points).
 * - Returns null when no track points exist.
 */
export async function loadOverviewTrack(
  driver: SqlDriver,
): Promise<OverviewTrackFeature | null> {
  const rows = await driver.all<{ segment_id: number; lon: number; lat: number }>(
    `SELECT segment_id, lon, lat
       FROM points
      ORDER BY segment_id, ts`,
  );

  if (rows.length === 0) return null;

  const lines: [number, number][][] = [];
  let currentSegment = -1;
  let currentLine: [number, number][] = [];
  let lastKept: { lon: number; lat: number } | null = null;
  let pendingLast: [number, number] | null = null;

  function finishSegment() {
    if (pendingLast !== null) {
      currentLine.push(pendingLast);
      pendingLast = null;
    }
    if (currentLine.length >= 2) {
      lines.push(currentLine);
    }
    currentLine = [];
    lastKept = null;
  }

  for (const row of rows) {
    if (row.segment_id !== currentSegment) {
      finishSegment();
      currentSegment = row.segment_id;
    }

    if (lastKept === null) {
      currentLine.push([row.lon, row.lat]);
      lastKept = row;
    } else if (
      distanceMetersSq(lastKept.lon, lastKept.lat, row.lon, row.lat) >=
      MIN_OVERVIEW_STEP_METERS_SQ
    ) {
      currentLine.push([row.lon, row.lat]);
      lastKept = row;
      pendingLast = null;
    } else {
      pendingLast = [row.lon, row.lat];
    }
  }

  finishSegment();

  if (lines.length === 0) return null;

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiLineString',
      coordinates: lines,
    },
  };
}
