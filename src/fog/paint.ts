/**
 * Painting explored ground onto the fog.
 *
 * A GPS fix does not clear a single cell — it clears a disc the size of the
 * brush radius, and consecutive fixes clear the corridor between them. All of
 * it happens in global bit space, where a circle stays a circle.
 */

import { popcount, createTile, setBit } from './bitmap';
import { TILE_BITS, locationToGlobalBit, metersPerBit } from './tiles';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Somewhere tiles can be fetched and created on demand. */
export interface FogCanvas {
  /** The tile at these coordinates, created fully fogged if it is new. */
  tile(x: number, y: number): Uint8Array;
}

export interface TileCoord {
  x: number;
  y: number;
}

export interface MemoryCanvas extends FogCanvas {
  /** The tile if it exists, without creating it. */
  peek(x: number, y: number): Uint8Array | undefined;
  /**
   * Adopt an existing bitmap, so fog loaded from storage is painted on top of
   * rather than replaced. The array is used directly and mutated in place.
   */
  put(x: number, y: number, tile: Uint8Array): void;
  tileCount(): number;
  exploredCells(): number;
}

/** An in-memory canvas — used by tests and by batch recomputation. */
export function createMemoryCanvas(): MemoryCanvas {
  const tiles = new Map<string, Uint8Array>();
  const key = (x: number, y: number) => `${x}/${y}`;

  return {
    tile(x, y) {
      const k = key(x, y);
      let tile = tiles.get(k);
      if (!tile) {
        tile = createTile();
        tiles.set(k, tile);
      }
      return tile;
    },
    peek: (x, y) => tiles.get(key(x, y)),
    put(x, y, tile) {
      tiles.set(key(x, y), tile);
    },
    tileCount: () => tiles.size,
    exploredCells: () => {
      let total = 0;
      for (const tile of tiles.values()) total += popcount(tile);
      return total;
    },
  };
}

/**
 * Fill a disc on the global bit grid.
 *
 * Tiles are resolved per row rather than per cell — a 30 m brush spans about
 * 14 cells per row, so this turns most of the map lookups into cache hits.
 */
function fillDisc(
  canvas: FogCanvas,
  gx: number,
  gy: number,
  radiusBits: number,
): number {
  const radiusSquared = radiusBits * radiusBits;
  const minY = Math.floor(gy - radiusBits);
  const maxY = Math.ceil(gy + radiusBits);
  let painted = 0;

  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - gy;
    const span = radiusSquared - dy * dy;
    if (span < 0) continue;

    const halfWidth = Math.sqrt(span);
    const minX = Math.floor(gx - halfWidth);
    const maxX = Math.ceil(gx + halfWidth);

    const tileY = Math.floor(y / TILE_BITS);
    const by = y - tileY * TILE_BITS;

    let tileX = NaN;
    let tile: Uint8Array | undefined;

    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - gx;
      if (dx * dx + dy * dy > radiusSquared) continue;

      const currentTileX = Math.floor(x / TILE_BITS);
      if (currentTileX !== tileX) {
        tileX = currentTileX;
        tile = canvas.tile(tileX, tileY);
      }

      if (setBit(tile!, x - tileX * TILE_BITS, by)) painted++;
    }
  }

  return painted;
}

/**
 * Which tiles a paint of this segment could touch.
 *
 * Callers use this to load the affected bitmaps out of storage before
 * painting, since painting itself is synchronous. It bounds the swept
 * corridor, so a diagonal run may name a few tiles the brush never reaches —
 * loading a spare tile is cheap, missing one would lose fog.
 */
export function tilesCovering(
  from: LatLon,
  to: LatLon,
  radiusMeters: number,
): TileCoord[] {
  const start = locationToGlobalBit(from.lat, from.lon);
  const end = locationToGlobalBit(to.lat, to.lon);
  const radiusBits = radiusMeters / metersPerBit((from.lat + to.lat) / 2);

  const tileRange = (low: number, high: number) => ({
    min: Math.floor((low - radiusBits) / TILE_BITS),
    max: Math.floor((high + radiusBits) / TILE_BITS),
  });

  const xs = tileRange(Math.min(start.gx, end.gx), Math.max(start.gx, end.gx));
  const ys = tileRange(Math.min(start.gy, end.gy), Math.max(start.gy, end.gy));

  const covered: TileCoord[] = [];
  for (let y = ys.min; y <= ys.max; y++) {
    for (let x = xs.min; x <= xs.max; x++) {
      covered.push({ x, y });
    }
  }

  return covered;
}

/**
 * Clear the fog around a single fix.
 *
 * @returns how many cells this call newly explored.
 */
export function paintPoint(
  canvas: FogCanvas,
  lat: number,
  lon: number,
  radiusMeters: number,
): number {
  const { gx, gy } = locationToGlobalBit(lat, lon);
  return fillDisc(canvas, gx, gy, radiusMeters / metersPerBit(lat));
}

/**
 * Clear the corridor walked between two consecutive fixes.
 *
 * The caller decides whether two fixes are close enough in time and space to
 * be joined at all — see the interpolation limits in the spec. By the time a
 * segment reaches here, the corridor is assumed to have been travelled.
 *
 * @returns how many cells this call newly explored.
 */
export function paintSegment(
  canvas: FogCanvas,
  from: LatLon,
  to: LatLon,
  radiusMeters: number,
): number {
  const start = locationToGlobalBit(from.lat, from.lon);
  const end = locationToGlobalBit(to.lat, to.lon);
  const radiusBits =
    radiusMeters / metersPerBit((from.lat + to.lat) / 2);

  const dx = end.gx - start.gx;
  const dy = end.gy - start.gy;
  const length = Math.hypot(dx, dy);

  // Consecutive discs must overlap or the corridor comes out beaded. Half the
  // radius keeps the edges smooth without painting the same cells repeatedly.
  const stride = Math.max(radiusBits / 2, 1);
  const steps = Math.max(1, Math.ceil(length / stride));

  let painted = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    painted += fillDisc(canvas, start.gx + dx * t, start.gy + dy * t, radiusBits);
  }

  return painted;
}
