/**
 * Reading the database snapshot for the recorder, apart from React.
 */

import { exploredSquareMeters } from '../fog/area';
import type { TileBitmap } from '../fog/geojson';
import type { SqlDriver } from '../store/driver';
import {
  getFogTilesSignature,
  loadAllTiles,
  recentRejections,
  type FogTilesSignature,
  type RejectionSummary,
} from '../store/fogTiles';
import { getPointsSignature, totalDistanceMeters, type PointsSignature } from '../store/stats';

export const REJECTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RecorderSnapshot {
  tiles: TileBitmap[];
  rejections: RejectionSummary[];
  distanceMeters: number;
  exploredSquareMeters: number;
}

export interface CacheState {
  fogSignature: FogTilesSignature | null;
  pointsSignature: PointsSignature | null;
  tiles: TileBitmap[];
  exploredSquareMeters: number;
  distanceMeters: number;
}

export function sameRejections(a: RejectionSummary[], b: RejectionSummary[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].reason !== b[i].reason || a[i].count !== b[i].count || a[i].lastAt !== b[i].lastAt) {
      return false;
    }
  }
  return true;
}

/**
 * Read the current recorder snapshot from the database.
 *
 * If `onPartial` is supplied and distance needs to be computed, `onPartial` is
 * called as soon as the tiles and explored area are ready, so the map can render
 * the fog immediately without waiting for the full track distance calculation.
 */
export async function readSnapshot(
  driver: SqlDriver,
  cache: CacheState,
  onPartial?: (snapshot: RecorderSnapshot) => void,
): Promise<RecorderSnapshot> {
  const [fogSig, pointsSig, rejections] = await Promise.all([
    getFogTilesSignature(driver),
    getPointsSignature(driver),
    recentRejections(driver, Date.now() - REJECTION_WINDOW_MS),
  ]);

  let tiles = cache.tiles;
  let explored = cache.exploredSquareMeters;
  let distanceMeters = cache.distanceMeters;

  // Only reload all tile BLOBs and recalculate popcounts if tiles actually changed.
  if (
    cache.fogSignature === null ||
    cache.fogSignature.count !== fogSig.count ||
    cache.fogSignature.lastUpdated !== fogSig.lastUpdated
  ) {
    tiles = await loadAllTiles(driver);
    explored = exploredSquareMeters(tiles);
    cache.fogSignature = fogSig;
    cache.tiles = tiles;
    cache.exploredSquareMeters = explored;
  }

  const pointsChanged =
    cache.pointsSignature === null ||
    cache.pointsSignature.count !== pointsSig.count ||
    cache.pointsSignature.lastTs !== pointsSig.lastTs;

  // Hand on tiles early if distance needs recomputation.
  if (pointsChanged && onPartial) {
    onPartial({
      tiles,
      rejections,
      distanceMeters,
      exploredSquareMeters: explored,
    });
  }

  // Only recompute total distance if points actually changed.
  if (pointsChanged) {
    distanceMeters = await totalDistanceMeters(driver, pointsSig);
    cache.pointsSignature = pointsSig;
    cache.distanceMeters = distanceMeters;
  }

  return {
    tiles,
    rejections,
    distanceMeters,
    exploredSquareMeters: explored,
  };
}
