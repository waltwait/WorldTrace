/**
 * What the map is looking at, and how much of the fog it is worth building.
 *
 * Building the fog for the whole world costs seconds of blocked JS and hands
 * the renderer far more than it can draw — a zoomed-out tile holds more holes
 * than the native fill path will keep. What the screen needs is the fog for
 * what the screen shows, at the detail the screen can tell apart. Everything
 * here is arithmetic over a bounding box, so it is all testable off-device.
 */

import { GRID_TILES, locationToGlobalBit, TILE_BITS } from './tiles';

/** The map's visible rectangle, as reported by its region events. */
export interface FogView {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
}

/** A rectangle of tiles at the fog's zoom, edges included. */
export interface TileRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Web Mercator stops here; the projection has nothing further north or south. */
const MAX_LAT = 85.0511287798;

/** A map zoom level is the log2 of how many pixels one cell-wide step spans. */
const ZOOM_OF_ONE_PIXEL_CELLS = 14;

export function isUsableView(view: FogView | null | undefined): view is FogView {
  if (!view) return false;

  const { west, south, east, north, zoom } = view;
  return (
    [west, south, east, north, zoom].every(Number.isFinite) && south <= north
  );
}

/**
 * A view from what the map reports: its bounds as [west, south, east, north] and
 * its zoom. Null when that is not something to draw by — the fog then stays
 * over the whole world rather than guessing.
 */
export function viewFromMap(
  state: { bounds: readonly number[]; zoom: number } | null | undefined,
): FogView | null {
  if (!state || state.bounds.length !== 4) return null;

  const [west, south, east, north] = state.bounds;
  const view = { west, south, east, north, zoom: state.zoom };

  return isUsableView(view) ? view : null;
}

/**
 * How many cells to a block when tracing a tile at this zoom.
 *
 * A cell is 2^(zoom - 14) screen pixels across (the map's world is 512 px at
 * zoom 0, the fog grid 2^23 cells). Once cells shrink below a pixel they cannot
 * be told apart, so cells are grouped into blocks that are as wide as possible
 * while staying within a pixel. The cost of a build then tracks the size of the
 * screen, not how far out the map is zoomed.
 */
export function scaleForZoom(zoom: number): number {
  const steps = Math.floor(ZOOM_OF_ONE_PIXEL_CELLS - zoom);
  const widest = Math.log2(TILE_BITS);

  return 2 ** Math.min(Math.max(steps, 0), widest);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * The tiles a view touches, widened by `margin` tiles on every side.
 *
 * Longitudes arrive unwrapped — a map dragged past the date line reports 190°,
 * not -170° — and a view that crosses the antimeridian has its west edge east
 * of its east edge. Neither can be told apart from the ground it shows, so both
 * come back as every column: more than needed, never less.
 */
export function tileRangeOf(view: FogView, margin = 0): TileRange {
  const lastTile = GRID_TILES - 1;

  const shift = Math.floor((view.west + 180) / 360) * 360;
  const west = view.west - shift;
  const east = view.east - shift;
  const wrapsAround = east < west || east > 180 || view.east - view.west >= 360;

  const toColumn = (lon: number) =>
    Math.floor(((lon + 180) / 360) * GRID_TILES);
  const toRow = (lat: number) =>
    Math.floor(locationToGlobalBit(clamp(lat, -MAX_LAT, MAX_LAT), 0).gy / TILE_BITS);

  return {
    x0: wrapsAround ? 0 : clamp(toColumn(west) - margin, 0, lastTile),
    x1: wrapsAround ? lastTile : clamp(toColumn(east) + margin, 0, lastTile),
    y0: clamp(toRow(view.north) - margin, 0, lastTile),
    y1: clamp(toRow(view.south) + margin, 0, lastTile),
  };
}

/**
 * Where the middle of the view falls on the tile grid, in fractional tiles.
 * Wraps the same way tileRangeOf does: a view across the date line is centred
 * on the date line, not on the far side of the world.
 */
export function tileCentreOf(view: FogView): { x: number; y: number } {
  const shift = Math.floor((view.west + 180) / 360) * 360;
  const west = view.west - shift;
  let east = view.east - shift;
  if (east < west) east += 360;

  const lon = (west + east) / 2;
  const lat = clamp((view.north + view.south) / 2, -MAX_LAT, MAX_LAT);
  const wrapped = (((lon + 180) / 360) % 1 + 1) % 1;

  return {
    x: wrapped * GRID_TILES,
    y: locationToGlobalBit(lat, 0).gy / TILE_BITS,
  };
}

export function rangeContains(outer: TileRange, inner: TileRange): boolean {
  return (
    inner.x0 >= outer.x0 &&
    inner.x1 <= outer.x1 &&
    inner.y0 >= outer.y0 &&
    inner.y1 <= outer.y1
  );
}
