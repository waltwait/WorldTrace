/**
 * Dividing the world into pieces of fog small enough to draw.
 *
 * One polygon over the whole world with every explored hole punched out of it
 * grows without bound: the renderer clips it to each map tile, and at a low zoom
 * every tile holds thousands of holes. The native fill path keeps only the 500
 * largest holes of a polygon and refuses one with more than 65 535 vertices, so
 * past a point the fog draws wrongly, and what it draws wrongly is the history.
 *
 * Here the world is cut into a quadtree of squares, down to single tiles. Where
 * no tile is live a whole square is just fog — one polygon, no holes, however
 * large. A live tile gets a polygon of its own: its square, with only that
 * tile's holes in it. So no polygon ever holds more than one tile's worth of
 * detail, however much has been explored or however far out the map is zoomed.
 *
 * The squares are cut along tile boundaries computed the same way as the rings
 * that meet them, so neighbours share their edges exactly: no gap to show the
 * map through, and — with the layer's antialiasing off — no doubled line.
 */

import type { Ring, TileTrace } from './geojson';
import { globalBitToLocation, GRID_TILES, TILE_BITS } from './tiles';

export interface LiveTile {
  x: number;
  y: number;
  trace: TileTrace;
}

/**
 * The square of `size` tiles whose top-left tile is (x, y), wound clockwise like
 * the world ring so that it and the counter-clockwise holes in it agree.
 */
function squareRing(x: number, y: number, size: number): Ring {
  const northWest = globalBitToLocation(x * TILE_BITS, y * TILE_BITS);
  const southEast = globalBitToLocation((x + size) * TILE_BITS, (y + size) * TILE_BITS);

  return [
    [northWest.lon, southEast.lat],
    [northWest.lon, northWest.lat],
    [southEast.lon, northWest.lat],
    [southEast.lon, southEast.lat],
    [northWest.lon, southEast.lat],
  ];
}

function visit(x: number, y: number, size: number, tiles: LiveTile[], out: Ring[][]): void {
  if (tiles.length === 0) {
    out.push([squareRing(x, y, size)]);
    return;
  }

  if (size === 1) {
    const [tile] = tiles;
    out.push([squareRing(x, y, 1), ...tile.trace.outlines]);
    for (const pocket of tile.trace.pockets) out.push(pocket);
    return;
  }

  const half = size / 2;
  const quadrants: LiveTile[][] = [[], [], [], []];
  for (const tile of tiles) {
    quadrants[(tile.x >= x + half ? 1 : 0) + (tile.y >= y + half ? 2 : 0)].push(tile);
  }

  visit(x, y, half, quadrants[0], out);
  visit(x + half, y, half, quadrants[1], out);
  visit(x, y + half, half, quadrants[2], out);
  visit(x + half, y + half, half, quadrants[3], out);
}

/**
 * The fog as a list of polygons that between them cover every point of the
 * world exactly once, except where one of `tiles` is explored.
 */
export function partitionFog(tiles: LiveTile[]): Ring[][] {
  const out: Ring[][] = [];
  visit(0, 0, GRID_TILES, tiles, out);
  return out;
}
