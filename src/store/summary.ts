/**
 * Everything the stats screen and the achievement rules need, in one read.
 */

import { exploredSquareMeters } from '../fog/area';
import { popcount } from '../fog/bitmap';
import type { SqlDriver } from './driver';
import { loadAllTiles } from './fogTiles';
import { buildMilestones, type Milestones } from './milestones';
import { countPlaces, type PlaceCounts } from './places';
import { totalDistanceMeters } from './stats';

/**
 * Totals, plus the personal bests the harder achievements are built on.
 *
 * One interface rather than two because every consumer wants both, and keeping
 * them apart only meant every screen threading two objects around.
 */
export interface Summary extends Milestones, PlaceCounts {
  exploredCells: number;
  exploredSquareMeters: number;
  distanceMeters: number;
  tileCount: number;
  dayCount: number;
  segmentCount: number;
  firstRecordedAt: number | null;
  lastRecordedAt: number | null;
}

export async function buildSummary(driver: SqlDriver): Promise<Summary> {
  const [tiles, distanceMeters, span, days, segments, milestones, places] = await Promise.all([
    loadAllTiles(driver),
    totalDistanceMeters(driver),
    driver.get<{ first: number | null; last: number | null }>(
      'SELECT MIN(ts) AS first, MAX(ts) AS last FROM points',
    ),
    driver.get<{ count: number }>(
      `SELECT COUNT(DISTINCT date(ts / 1000, 'unixepoch', 'localtime')) AS count FROM points`,
    ),
    // Counted from points, not from the segments table: an outing that never
    // produced a fix is not an outing anyone made.
    driver.get<{ count: number }>('SELECT COUNT(DISTINCT segment_id) AS count FROM points'),
    buildMilestones(driver),
    countPlaces(driver),
  ]);

  // Fog is counted independently of points. The bitmaps are the durable record
  // of explored ground — they survive a track that was trimmed or exported
  // away, and the map draws from them, so the stats must agree with the map.
  const exploredCells = tiles.reduce((total, tile) => total + popcount(tile.bitmap), 0);

  return {
    ...milestones,
    ...places,
    exploredCells,
    exploredSquareMeters: exploredSquareMeters(tiles),
    distanceMeters,
    tileCount: tiles.length,
    dayCount: days?.count ?? 0,
    segmentCount: segments?.count ?? 0,
    firstRecordedAt: span?.first ?? null,
    lastRecordedAt: span?.last ?? null,
  };
}
