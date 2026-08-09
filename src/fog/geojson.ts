/**
 * Turning fog bitmaps into map geometry.
 *
 * MapLibre draws the explored area as a filled shape punched out of a dark
 * overlay, so the bitmaps have to become polygons. Cells are merged along each
 * row before being emitted, which collapses a walked street from hundreds of
 * squares into a handful of rectangles.
 *
 * Rows are not merged vertically. Doing so needs a proper contour trace, and
 * at city scale the row-wise version already keeps the geometry small enough;
 * revisit this before the raster-tile renderer, not after.
 */

import { TILE_BITS, globalBitToLocation } from './tiles';
import { getBit } from './bitmap';

export type Position = [number, number];
export type Ring = Position[];

export interface TileBitmap {
  x: number;
  y: number;
  bitmap: Uint8Array;
}

export interface MultiPolygonFeature {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: {
    type: 'MultiPolygon';
    coordinates: Ring[][];
  };
}

export interface PolygonFeature {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: {
    type: 'Polygon';
    coordinates: Ring[];
  };
}

/**
 * The world, wound clockwise so that the counter-clockwise explored rings
 * read as holes in it. Latitude stops just short of the poles because Web
 * Mercator cannot represent them.
 */
const WORLD_RING: Ring = [
  [-180, -85.051129],
  [-180, 85.051129],
  [180, 85.051129],
  [180, -85.051129],
  [-180, -85.051129],
];

/**
 * The fog itself: one dark polygon over the whole world with every explored
 * cell punched out of it. This is what gets drawn — the map shows through the
 * holes, everything else stays covered.
 */
export function fogFeature(tiles: TileBitmap[]): PolygonFeature {
  const holes: Ring[] = [];

  for (const tile of tiles) {
    holes.push(...exploredRings(tile.x, tile.y, tile.bitmap));
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [WORLD_RING, ...holes] },
  };
}

/**
 * The explored cells of one tile, as closed rectangular rings in lon/lat.
 * Wound counter-clockwise, which is what GeoJSON asks of an exterior ring.
 */
export function exploredRings(x: number, y: number, bitmap: Uint8Array): Ring[] {
  const rings: Ring[] = [];
  const originX = x * TILE_BITS;
  const originY = y * TILE_BITS;

  for (let by = 0; by < TILE_BITS; by++) {
    let runStart: number | null = null;

    for (let bx = 0; bx <= TILE_BITS; bx++) {
      const explored = bx < TILE_BITS && getBit(bitmap, bx, by);

      if (explored && runStart === null) {
        runStart = bx;
      } else if (!explored && runStart !== null) {
        rings.push(rectangle(originX + runStart, originX + bx, originY + by));
        runStart = null;
      }
    }
  }

  return rings;
}

/** A closed ring covering one row of cells between two global bit columns. */
function rectangle(fromX: number, toX: number, rowY: number): Ring {
  const west = globalBitToLocation(fromX, rowY).lon;
  const east = globalBitToLocation(toX, rowY).lon;
  // Bit rows count southward, so the row's own index is its northern edge.
  const north = globalBitToLocation(fromX, rowY).lat;
  const south = globalBitToLocation(fromX, rowY + 1).lat;

  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/**
 * Every explored cell across a set of tiles, as one feature ready to hand to
 * a MapLibre shape source. Null when nothing has been explored — an empty
 * MultiPolygon renders as a stray artefact on some styles.
 */
export function exploredFeature(tiles: TileBitmap[]): MultiPolygonFeature | null {
  const polygons: Ring[][] = [];

  for (const tile of tiles) {
    for (const ring of exploredRings(tile.x, tile.y, tile.bitmap)) {
      polygons.push([ring]);
    }
  }

  if (polygons.length === 0) return null;

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  };
}
