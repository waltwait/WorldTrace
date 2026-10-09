/**
 * The fog geometry for what the map is showing, rebuilt only where it must be.
 *
 * Two costs used to dominate. Tracing every tile on every change meant seconds
 * of blocked JS at the scale one person reaches after a year of walking, and
 * handing the renderer the whole world's fog at once meant a polygon with more
 * holes than it can draw. Both come from doing work for ground nobody is
 * looking at.
 *
 * So this builds only the tiles inside the view (plus a margin, so a small drag
 * does not run into bare fog), at the grain the zoom can show, and covers the
 * rest of the world with plain fog. That cover is deliberate and safe: the worst
 * a missed tile does is stay dark until the map settles over it, never show
 * ground as explored that was not.
 *
 * A tile's geometry depends on nothing but its bitmap and the grain, so what was
 * traced stays valid until either changes. Comparing 2 KB per tile costs
 * microseconds against the milliseconds that tracing one costs.
 */

import { partitionFog, type LiveTile } from './fogPartition';
import { fogOf, traceTile, type MultiPolygonFeature, type TileBitmap, type TileTrace } from './geojson';
import { GRID_TILES } from './tiles';
import {
  isUsableView,
  rangeContains,
  scaleForZoom,
  tileCentreOf,
  tileRangeOf,
  type FogView,
  type TileRange,
} from './view';

interface Traced {
  bitmap: Uint8Array;
  scale: number;
  trace: TileTrace;
}

export interface FogBuilder {
  /**
   * The fog for what `view` shows, or fog over the whole world while there is
   * no view yet. Hands back the very same object when the last build still
   * serves, so a caller can tell nothing changed by comparing references.
   */
  build(tiles: TileBitmap[], view: FogView | null): MultiPolygonFeature;
  /**
   * Whether `build` would hand back the fog it already has. Cheap enough to ask
   * on every frame of a gesture, which is the point: the fog can be redrawn the
   * moment a zoom crosses into a finer grain or a drag leaves what was drawn,
   * instead of only once the map has come to rest.
   */
  isCurrent(tiles: TileBitmap[], view: FogView | null): boolean;
  /** Tiles currently remembered. Exposed so tests can see the cache is bounded. */
  readonly size: number;
}

/**
 * How many tiles to remember beyond the ones the last build used. A tile traced
 * at full detail is a few KB of coordinates; this keeps the cache to tens of MB
 * at worst while still making a drag back to a place just left free.
 */
const REMEMBERED_TILES = 600;

/**
 * Zoomed out, tiles are traced in coarse blocks, and zooming in on those blocks
 * magnifies them into patches of ground that look explored and were not, until
 * the fog has been redrawn at the new zoom. Redrawing takes a moment, and a fast
 * zoom outruns it. Zooms land near the middle of the screen far more often than
 * not, so the tiles around the middle are traced in full whatever the zoom:
 * when the zoom arrives the fog there is already right.
 *
 * Tiles within HOT_RADIUS of the middle, nearest first, up to HOT_TILES of them
 * — enough for a street-level screen and its margin, few enough that tracing
 * them stays cheap. The middle may drift HOT_DRIFT tiles before the detail is
 * moved to follow it.
 */
export const HOT_TILES = 36;
const HOT_RADIUS = 3;
const HOT_DRIFT = 2;

const WORLD_OF_FOG = fogOf(partitionFog([]));

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface Drawn {
  fog: MultiPolygonFeature;
  tiles: TileBitmap[] | null;
  scale: number;
  range: TileRange | null;
  /** Where the full-detail tiles were gathered round; null when all are full detail. */
  centre: { x: number; y: number } | null;
}

function withinDrift(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) <= HOT_DRIFT;
}

export function createFogBuilder(remembered: number = REMEMBERED_TILES): FogBuilder {
  let traced = new Map<number, Traced>();
  let drawn: Drawn | null = null;

  /** The fog already drawn, if it still serves this view of these tiles. */
  const servedBy = (tiles: TileBitmap[], view: FogView | null): MultiPolygonFeature | null => {
    if (!drawn) return null;

    if (!isUsableView(view)) return drawn.range === null ? drawn.fog : null;

    if (
      drawn.range &&
      drawn.tiles === tiles &&
      drawn.scale === scaleForZoom(view.zoom) &&
      rangeContains(drawn.range, tileRangeOf(view)) &&
      (drawn.centre === null || withinDrift(drawn.centre, tileCentreOf(view)))
    ) {
      return drawn.fog;
    }

    return null;
  };

  return {
    get size() {
      return traced.size;
    },

    isCurrent(tiles: TileBitmap[], view: FogView | null): boolean {
      return servedBy(tiles, view) !== null;
    },

    build(tiles: TileBitmap[], view: FogView | null): MultiPolygonFeature {
      const current = servedBy(tiles, view);
      if (current) return current;

      if (!isUsableView(view)) {
        drawn = { fog: WORLD_OF_FOG, tiles: null, scale: 1, range: null, centre: null };
        return WORLD_OF_FOG;
      }

      const scale = scaleForZoom(view.zoom);
      const seen = tileRangeOf(view);

      // Half a screen of margin on every side, at least a tile.
      const across = Math.max(seen.x1 - seen.x0, seen.y1 - seen.y0) + 1;
      const range = tileRangeOf(view, Math.max(1, Math.ceil(across / 2)));

      // Keyed by a number, not a string: this runs over every tile on every
      // build, and a string per tile is a lot of garbage for the sake of a name.
      const next = new Map<number, Traced>();
      const present = new Set<number>();
      const inRange: TileBitmap[] = [];

      for (const tile of tiles) {
        present.add(tile.x * GRID_TILES + tile.y);

        if (tile.x >= range.x0 && tile.x <= range.x1 && tile.y >= range.y0 && tile.y <= range.y1) {
          inRange.push(tile);
        }
      }

      // The tiles round the middle keep full detail when everything else is
      // coarse; see HOT_TILES.
      const centre = scale > 1 ? tileCentreOf(view) : null;
      const detailed = new Set<number>();

      if (centre) {
        const near: Array<{ key: number; distance: number }> = [];

        for (const tile of inRange) {
          const dx = tile.x + 0.5 - centre.x;
          const dy = tile.y + 0.5 - centre.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) > HOT_RADIUS) continue;

          near.push({ key: tile.x * GRID_TILES + tile.y, distance: dx * dx + dy * dy });
        }

        near.sort((a, b) => a.distance - b.distance);
        for (const { key } of near.slice(0, HOT_TILES)) detailed.add(key);
      }

      const live: LiveTile[] = [];

      for (const tile of inRange) {
        const key = tile.x * GRID_TILES + tile.y;
        const grain = detailed.has(key) ? 1 : scale;

        const previous = traced.get(key);
        const entry =
          previous && previous.scale === grain && sameBytes(previous.bitmap, tile.bitmap)
            ? previous
            : {
                bitmap: tile.bitmap,
                scale: grain,
                trace: traceTile(tile.x, tile.y, tile.bitmap, grain),
              };

        next.set(key, entry);
        if (entry.trace.outlines.length > 0) live.push({ x: tile.x, y: tile.y, trace: entry.trace });
      }

      // What was traced earlier and is still on the ground stays, up to the
      // limit, so panning back to a place just left does not trace it again. A
      // tile that has gone — a restore from a smaller backup, say — is dropped
      // so it cannot leave its rings behind.
      for (const [key, entry] of traced) {
        if (next.size >= remembered) break;
        if (!next.has(key) && present.has(key)) next.set(key, entry);
      }

      traced = next;

      const fog = fogOf(partitionFog(live));
      drawn = { fog, tiles, scale, range, centre };
      return fog;
    },
  };
}
