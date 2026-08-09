/**
 * Repaint the fog from the points already recorded.
 *
 * The point table exists for this. Fog is painted once, live, under whatever
 * the interpolation limits were that day — so when those limits change, ground
 * that was genuinely travelled can be left as a hole for good. Widening the
 * limits fixes the future and does nothing for the past; this fixes the past.
 *
 * **It only ever adds.** Fog outlives the track: a restored snapshot, or points
 * trimmed away, can leave cleared ground with no points behind it. A rebuild
 * that cleared first and repainted would delete that silently, which is the one
 * unrecoverable mistake this app can make. So each tile is loaded, painted on
 * top of, and written back.
 */

import { popcount } from '../fog/bitmap';
import { canJoin } from '../fog/joining';
import { createMemoryCanvas, paintPoint, paintSegment, tilesCovering } from '../fog/paint';
import { FOG_ZOOM } from '../fog/tiles';
import type { SqlDriver } from './driver';
import { TRACKER_DEFAULTS } from './tracker';

export interface RebuildResult {
  pointsRead: number;
  /** Cells that were fogged before and are cleared now. */
  cellsAdded: number;
  tilesTouched: number;
}

interface PointRow {
  segment_id: number;
  ts: number;
  lat: number;
  lon: number;
}

export interface RebuildOptions {
  brushRadiusMeters?: number;
  maxInterpolationSeconds?: number;
  maxInterpolationMeters?: number;
}

export async function rebuildFog(
  driver: SqlDriver,
  options: RebuildOptions = {},
): Promise<RebuildResult> {
  const {
    brushRadiusMeters = TRACKER_DEFAULTS.brushRadiusMeters,
    maxInterpolationSeconds = TRACKER_DEFAULTS.maxInterpolationSeconds,
    maxInterpolationMeters = TRACKER_DEFAULTS.maxInterpolationMeters,
  } = options;
  const limits = { maxInterpolationSeconds, maxInterpolationMeters };

  // Ordered by time within each segment. Batched delivery can write fixes out
  // of order, and painting them as stored would draw the route doubling back
  // on itself.
  const points = await driver.all<PointRow>(
    'SELECT segment_id, ts, lat, lon FROM points ORDER BY segment_id, ts',
  );

  if (points.length === 0) return { pointsRead: 0, cellsAdded: 0, tilesTouched: 0 };

  const canvas = createMemoryCanvas();
  const before = new Map<string, number>();

  /** Load every tile a stroke will touch, so painting adds to what is there. */
  async function ensureLoaded(covered: { x: number; y: number }[]): Promise<void> {
    for (const tile of covered) {
      const key = `${tile.x}/${tile.y}`;
      if (before.has(key)) continue;

      const row = await driver.get<{ bitmap: Uint8Array }>(
        'SELECT bitmap FROM fog_tiles WHERE z = ? AND x = ? AND y = ?',
        [FOG_ZOOM, tile.x, tile.y],
      );

      // Copied: the driver may hand back a view onto a buffer it reuses.
      const existing = row ? Uint8Array.from(row.bitmap) : null;
      if (existing) canvas.put(tile.x, tile.y, existing);
      before.set(key, existing ? popcount(existing) : 0);
    }
  }

  let previous: PointRow | null = null;

  for (const point of points) {
    const fix = { lat: point.lat, lon: point.lon, timestamp: point.ts };
    const joinFrom =
      previous !== null && previous.segment_id === point.segment_id &&
      canJoin({ lat: previous.lat, lon: previous.lon, timestamp: previous.ts }, fix, limits)
        ? previous
        : null;

    const from = joinFrom ? { lat: joinFrom.lat, lon: joinFrom.lon } : null;
    await ensureLoaded(tilesCovering(from ?? fix, fix, brushRadiusMeters));

    if (from) paintSegment(canvas, from, fix, brushRadiusMeters);
    else paintPoint(canvas, fix.lat, fix.lon, brushRadiusMeters);

    previous = point;
  }

  const now = Date.now();
  let cellsAdded = 0;
  let tilesTouched = 0;

  // `before` holds exactly the tiles any stroke reached, which is the set worth
  // writing back — a tile nothing touched cannot have changed.
  for (const [key, was] of before) {
    const [x, y] = key.split('/').map(Number);
    const bitmap = canvas.peek(x, y);
    if (!bitmap) continue;

    const added = popcount(bitmap) - was;
    if (added <= 0) continue;

    cellsAdded += added;
    tilesTouched++;

    await driver.run(
      `INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (z, x, y) DO UPDATE SET bitmap = excluded.bitmap, updated_at = excluded.updated_at`,
      [FOG_ZOOM, x, y, bitmap, now],
    );
  }

  return { pointsRead: points.length, cellsAdded, tilesTouched };
}
