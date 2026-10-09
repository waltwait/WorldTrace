/**
 * A way to ask "what does this geometry actually cover?" without trusting any
 * of the code that produced it.
 *
 * The first tests of the contour tracer counted rings. A ring count cannot tell
 * a correct mask from one that quietly clears ground nobody walked, which is
 * exactly the bug a closed loop exposed. These helpers rasterise the output
 * instead: take the centre of every bitmap cell and ask whether the geometry
 * covers it. Polygons are read with plain GeoJSON meaning — inside the exterior
 * and outside every hole — not with whatever fill rule a renderer might apply.
 */

import { getBit, setBit } from '../bitmap';
import type { Ring } from '../geojson';
import { globalBitToLocation, TILE_BITS } from '../tiles';

/** One polygon: an exterior followed by its holes. */
export type Polygon = Ring[];

/**
 * Draw a bitmap from text. '#' is an explored cell, anything else is fog. The
 * picture's top-left corner lands on (bx0, by0) of the tile.
 */
export function bitmapFromRows(
  rows: string[],
  bitmap: Uint8Array,
  bx0 = 0,
  by0 = 0,
): Uint8Array {
  rows.forEach((row, dy) => {
    [...row].forEach((char, dx) => {
      if (char === '#') setBit(bitmap, bx0 + dx, by0 + dy);
    });
  });
  return bitmap;
}

/** The middle of a cell, in lon/lat, strictly inside it on both axes. */
export function cellCentre(x: number, y: number, bx: number, by: number): [number, number] {
  const gx = x * TILE_BITS + bx;
  const gy = y * TILE_BITS + by;
  const top = globalBitToLocation(gx, gy);
  const bottom = globalBitToLocation(gx + 1, gy + 1);

  return [(top.lon + bottom.lon) / 2, (top.lat + bottom.lat) / 2];
}

function insideRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/** How many polygons of a MultiPolygon cover the point. */
export function coverCount(polygons: Polygon[], lon: number, lat: number): number {
  let count = 0;

  for (const [exterior, ...holes] of polygons) {
    if (insideRing(lon, lat, exterior) && !holes.some((hole) => insideRing(lon, lat, hole))) {
      count++;
    }
  }

  return count;
}

/** Whether any polygon of a MultiPolygon covers the point. */
export function covers(polygons: Polygon[], lon: number, lat: number): boolean {
  return coverCount(polygons, lon, lat) > 0;
}

/** A feature's polygons, whichever of Polygon or MultiPolygon it holds. */
export function polygonsOf(feature: {
  geometry: { type: string; coordinates: unknown };
}): Polygon[] {
  return feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Polygon]
    : (feature.geometry.coordinates as Polygon[]);
}

/**
 * Every cell in a window where the geometry and the bitmap disagree. Empty
 * means the geometry covers exactly the fogged cells (`expect: 'fogged'`) or
 * exactly the explored ones (`expect: 'explored'`).
 */
export function mismatches(
  polygons: Polygon[],
  tile: { x: number; y: number; bitmap: Uint8Array },
  expect: 'fogged' | 'explored',
  window: { bx0: number; by0: number; bx1: number; by1: number },
): string[] {
  const wrong: string[] = [];

  for (let by = window.by0; by <= window.by1; by++) {
    for (let bx = window.bx0; bx <= window.bx1; bx++) {
      const [lon, lat] = cellCentre(tile.x, tile.y, bx, by);
      const explored = getBit(tile.bitmap, bx, by);
      const wanted = expect === 'fogged' ? !explored : explored;

      if (covers(polygons, lon, lat) !== wanted) wrong.push(`${bx},${by}`);
    }
  }

  return wrong;
}
