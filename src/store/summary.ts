/**
 * Everything the stats screen and the achievement rules need, in one read.
 */

import { exploredSquareMeters } from '../fog/area';
import { popcount } from '../fog/bitmap';
import type { SqlDriver } from './driver';
import { getFogTilesSignature, loadAllTiles, type FogTilesSignature } from './fogTiles';
import { buildMilestones, type Milestones } from './milestones';
import { countPlaces, type PlaceCounts } from './places';
import { getPointsSignature, totalDistanceMeters, type PointsSignature } from './stats';

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

interface SummaryCacheEntry {
  fogSig: FogTilesSignature;
  pointsSig: PointsSignature;
  summary: Summary;
}

const summaryCache = new WeakMap<SqlDriver, SummaryCacheEntry>();
let latestGlobalSummary: Summary | null = null;

export function getCachedSummary(): Summary | null {
  return latestGlobalSummary;
}

export async function buildSummary(
  driver: SqlDriver,
  options?: { fogSig?: FogTilesSignature; pointsSig?: PointsSignature },
): Promise<Summary> {
  const [fogSig, pointsSig] = await Promise.all([
    options?.fogSig ?? getFogTilesSignature(driver),
    options?.pointsSig ?? getPointsSignature(driver),
  ]);

  const cached = summaryCache.get(driver);
  if (
    cached &&
    cached.fogSig.count === fogSig.count &&
    cached.fogSig.lastUpdated === fogSig.lastUpdated &&
    cached.pointsSig.count === pointsSig.count &&
    cached.pointsSig.lastTs === pointsSig.lastTs
  ) {
    return cached.summary;
  }

  // Fog tiles: only reload all binary BLOBs and recalculate popcounts if tiles changed
  const fogUnchanged =
    cached &&
    cached.fogSig.count === fogSig.count &&
    cached.fogSig.lastUpdated === fogSig.lastUpdated;

  const tilesPromise = fogUnchanged ? null : loadAllTiles(driver);

  // Points: only re-query points and milestones if points changed
  const pointsUnchanged =
    cached &&
    cached.pointsSig.count === pointsSig.count &&
    cached.pointsSig.lastTs === pointsSig.lastTs;

  const pointsQueries = pointsUnchanged
    ? null
    : Promise.all([
        totalDistanceMeters(driver, pointsSig),
        driver.get<{ first: number | null; last: number | null }>(
          'SELECT MIN(ts) AS first, MAX(ts) AS last FROM points',
        ),
        driver.get<{ count: number }>(
          `SELECT COUNT(DISTINCT date(ts / 1000, 'unixepoch', 'localtime')) AS count FROM points`,
        ),
        driver.get<{ count: number }>('SELECT COUNT(DISTINCT segment_id) AS count FROM points'),
        buildMilestones(driver, pointsSig),
      ]);

  const [tiles, pointsResult, places] = await Promise.all([
    tilesPromise,
    pointsQueries,
    countPlaces(driver),
  ]);

  let exploredCells = cached?.summary.exploredCells ?? 0;
  let exploredMeters = cached?.summary.exploredSquareMeters ?? 0;
  let tileCount = cached?.summary.tileCount ?? 0;

  if (tiles !== null) {
    exploredCells = tiles.reduce((total, tile) => total + popcount(tile.bitmap), 0);
    exploredMeters = exploredSquareMeters(tiles);
    tileCount = tiles.length;
  }

  let distanceMeters = cached?.summary.distanceMeters ?? 0;
  let span = cached?.summary
    ? { first: cached.summary.firstRecordedAt, last: cached.summary.lastRecordedAt }
    : null;
  let dayCount = cached?.summary.dayCount ?? 0;
  let segmentCount = cached?.summary.segmentCount ?? 0;
  let milestones: Milestones = cached?.summary ?? {
    longestStreakDays: 0,
    maxDayDistanceMeters: 0,
    longestOutingMeters: 0,
    farthestFromStartMeters: 0,
    nightDayCount: 0,
    dawnDayCount: 0,
  };

  if (pointsResult !== null) {
    const [dist, sp, days, segments, ms] = pointsResult;
    distanceMeters = dist;
    span = sp ?? null;
    dayCount = days?.count ?? 0;
    segmentCount = segments?.count ?? 0;
    milestones = ms;
  }

  const summary: Summary = {
    ...milestones,
    ...places,
    exploredCells,
    exploredSquareMeters: exploredMeters,
    distanceMeters,
    tileCount,
    dayCount,
    segmentCount,
    firstRecordedAt: span?.first ?? null,
    lastRecordedAt: span?.last ?? null,
  };

  summaryCache.set(driver, { fogSig, pointsSig, summary });
  latestGlobalSummary = summary;
  return summary;
}
