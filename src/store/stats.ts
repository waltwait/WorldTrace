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

/**
 * Ground covered, summed leg by leg.
 *
 * Legs are only counted within a segment. The gap between two segments is a
 * flight, a subway ride, or a phone that was switched off — never a walk — so
 * joining across one would invent distance that was never travelled.
 */
export async function totalDistanceMeters(driver: SqlDriver): Promise<number> {
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

  return total;
}
