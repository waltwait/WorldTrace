/**
 * Reading fog back out for rendering.
 */

import type { TileBitmap } from '../fog/geojson';
import { FOG_ZOOM } from '../fog/tiles';
import type { RejectionReason } from '../gatekeeper/gatekeeper';
import type { SqlDriver } from './driver';

/**
 * Every explored tile.
 *
 * Loading the lot is fine at the scale one person walks — a year of daily
 * commuting is a few thousand tiles of 2 KB. When that stops being true the
 * fix is a viewport query here plus the raster-tile renderer, not a cache.
 */
export async function loadAllTiles(driver: SqlDriver): Promise<TileBitmap[]> {
  const rows = await driver.all<{ x: number; y: number; bitmap: Uint8Array }>(
    'SELECT x, y, bitmap FROM fog_tiles WHERE z = ? ORDER BY y, x',
    [FOG_ZOOM],
  );

  return rows.map((row) => ({
    x: row.x,
    y: row.y,
    bitmap: Uint8Array.from(row.bitmap),
  }));
}

export interface RejectionSummary {
  reason: RejectionReason;
  count: number;
  lastAt: number;
}

/**
 * Why fixes were refused recently.
 *
 * Surfaced in the UI so an over-strict rule shows up as "14 fixes refused:
 * mock provider" rather than as fog that mysteriously never clears.
 */
export async function recentRejections(
  driver: SqlDriver,
  since: number,
): Promise<RejectionSummary[]> {
  return driver.all<RejectionSummary>(
    `SELECT reason, COUNT(*) AS count, MAX(ts) AS lastAt
       FROM rejections
      WHERE ts >= ?
      GROUP BY reason
      ORDER BY count DESC`,
    [since],
  );
}
