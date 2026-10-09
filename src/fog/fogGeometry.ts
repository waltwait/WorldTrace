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
  /** Tiles currently remembered. Exposed so tests can see the cache is bounded. */
  readonly size: number;
}

/**
 * How many tiles to remember beyond the ones the last build used. A tile traced
 * at full detail is a few KB of coordinates; this keeps the cache to tens of MB
 * at worst while still making a drag back to a place just left free.
 */
const REMEMBERED_TILES = 600;

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
}

export function createFogBuilder(remembered: number = REMEMBERED_TILES): FogBuilder {
  let traced = new Map<number, Traced>();
  let drawn: Drawn | null = null;

  return {
    get size() {
      return traced.size;
    },

    build(tiles: TileBitmap[], view: FogView | null): MultiPolygonFeature {
      if (!isUsableView(view)) {
        drawn = { fog: WORLD_OF_FOG, tiles: null, scale: 1, range: null };
        return WORLD_OF_FOG;
      }

      const scale = scaleForZoom(view.zoom);
      const seen = tileRangeOf(view);

      if (
        drawn &&
        drawn.range &&
        drawn.tiles === tiles &&
        drawn.scale === scale &&
        rangeContains(drawn.range, seen)
      ) {
        return drawn.fog;
      }

      // Half a screen of margin on every side, at least a tile.
      const across = Math.max(seen.x1 - seen.x0, seen.y1 - seen.y0) + 1;
      const range = tileRangeOf(view, Math.max(1, Math.ceil(across / 2)));

      // Keyed by a number, not a string: this runs over every tile on every
      // build, and a string per tile is a lot of garbage for the sake of a name.
      const next = new Map<number, Traced>();
      const present = new Set<number>();
      const live: LiveTile[] = [];

      for (const tile of tiles) {
        const key = tile.x * GRID_TILES + tile.y;
        present.add(key);

        if (tile.x < range.x0 || tile.x > range.x1 || tile.y < range.y0 || tile.y > range.y1) {
          continue;
        }

        const previous = traced.get(key);
        const entry =
          previous && previous.scale === scale && sameBytes(previous.bitmap, tile.bitmap)
            ? previous
            : {
                bitmap: tile.bitmap,
                scale,
                trace: traceTile(tile.x, tile.y, tile.bitmap, scale),
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
      drawn = { fog, tiles, scale, range };
      return fog;
    },
  };
}
