/**
 * Derived numbers, read straight from the track.
 */

import { distanceMeters } from '../geo/distance';
import type { SqlDriver } from './driver';

interface PointRow {
  segment_id: number;
  lat: number;
  lon: number;
}

export interface PointsSignature {
  count: number;
  lastTs: number | null;
}

export async function getPointsSignature(driver: SqlDriver): Promise<PointsSignature> {
  const row = await driver.get<{ count: number; last_ts: number | null }>(
    'SELECT count(*) AS count, max(ts) AS last_ts FROM points',
  );
  return {
    count: row?.count ?? 0,
    lastTs: row?.last_ts ?? null,
  };
}

const distanceCache = new WeakMap<SqlDriver, { sig: PointsSignature; distance: number }>();

/**
 * Ground covered, summed leg by leg.
 *
 * Legs are only counted within a segment. The gap between two segments is a
 * flight, a subway ride, or a phone that was switched off — never a walk — so
 * joining across one would invent distance that was never travelled.
 */
export async function totalDistanceMeters(
  driver: SqlDriver,
  knownSig?: PointsSignature,
): Promise<number> {
  const sig = knownSig ?? (await getPointsSignature(driver));
  const cached = distanceCache.get(driver);
  if (cached && cached.sig.count === sig.count && cached.sig.lastTs === sig.lastTs) {
    return cached.distance;
  }

  const points = await driver.all<PointRow>(
    'SELECT segment_id, lat, lon FROM points ORDER BY segment_id, ts',
  );

  let total = 0;
  let previous: PointRow | null = null;

  for (const point of points) {
    if (previous !== null && previous.segment_id === point.segment_id) {
      total += distanceMeters(previous, point);
    }
    previous = point;
  }

  distanceCache.set(driver, { sig, distance: total });
  return total;
}
