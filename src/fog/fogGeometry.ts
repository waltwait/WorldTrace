/**
 * The fog geometry, rebuilt only where the ground actually changed.
 *
 * Tracing one tile's boundary rings is cheap; tracing every tile is not. At the
 * scale one person reaches after a year of walking — a few hundred tiles, tens
 * of km² — a full rebuild costs seconds of blocked JS, and the recorder asks
 * for one every few seconds while a walk is in progress. Every tap made during
 * that window queues behind it, which is what made the whole app feel slow.
 *
 * A tile's rings depend on nothing but its bitmap, so last read's rings stay
 * valid until the bytes differ. Comparing 2 KB per tile costs microseconds
 * against the milliseconds that tracing one costs.
 */

import { exploredRings, WORLD_RING, type PolygonFeature, type Ring, type TileBitmap } from './geojson';

interface Traced {
  bitmap: Uint8Array;
  rings: Ring[];
}

export interface FogBuilder {
  build(tiles: TileBitmap[]): PolygonFeature;
  /** Tiles currently remembered. Exposed so tests can see the cache is bounded. */
  readonly size: number;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function createFogBuilder(): FogBuilder {
  let traced = new Map<string, Traced>();

  return {
    get size() {
      return traced.size;
    },

    build(tiles: TileBitmap[]): PolygonFeature {
      // Rebuilt rather than pruned, so a tile that disappears — a restore from
      // a smaller backup, say — cannot leave its rings behind in the map.
      const next = new Map<string, Traced>();
      const holes: Ring[] = [];

      for (const tile of tiles) {
        const key = `${tile.x},${tile.y}`;
        const previous = traced.get(key);
        const entry =
          previous && sameBytes(previous.bitmap, tile.bitmap)
            ? previous
            : { bitmap: tile.bitmap, rings: exploredRings(tile.x, tile.y, tile.bitmap) };

        next.set(key, entry);
        for (const ring of entry.rings) holes.push(ring);
      }

      traced = next;

      return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [WORLD_RING, ...holes] },
      };
    },
  };
}
