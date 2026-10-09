import { describe, expect, it } from 'vitest';
import { setBit } from './bitmap';
import { fogFeature, type TileBitmap } from './geojson';
import { createFogBuilder } from './fogGeometry';
import { bitmapFromRows, cellCentre, coverCount, mismatches, polygonsOf } from './testing/oracle';
import { globalBitToLocation, locationToBit, TILE_BITS } from './tiles';
import type { FogView } from './view';

const BYTES = (128 * 128) / 8;

function tile(x: number, y: number, cells: Array<[number, number]>): TileBitmap {
  const bitmap = new Uint8Array(BYTES);
  for (const [bx, by] of cells) setBit(bitmap, bx, by);
  return { x, y, bitmap };
}

/** loadAllTiles hands back freshly allocated arrays on every read. */
function reread(tiles: TileBitmap[]): TileBitmap[] {
  return tiles.map((t) => ({ x: t.x, y: t.y, bitmap: Uint8Array.from(t.bitmap) }));
}

/** A view that exactly fits the tiles from (x0, y0) to (x1, y1), at a zoom. */
function viewOf(x0: number, y0: number, x1: number, y1: number, zoom = 16): FogView {
  const northWest = globalBitToLocation(x0 * TILE_BITS + 1, y0 * TILE_BITS + 1);
  const southEast = globalBitToLocation((x1 + 1) * TILE_BITS - 1, (y1 + 1) * TILE_BITS - 1);
  return {
    west: northWest.lon,
    north: northWest.lat,
    east: southEast.lon,
    south: southEast.lat,
    zoom,
  };
}

const HERE = locationToBit(25.033, 121.5654);

describe('createFogBuilder', () => {
  const tiles = [
    tile(HERE.x, HERE.y, [[4, 4], [5, 4], [4, 5]]),
    tile(HERE.x + 1, HERE.y, [[9, 9]]),
  ];
  const view = viewOf(HERE.x, HERE.y, HERE.x + 1, HERE.y);

  describe('with nothing to look at', () => {
    it('covers the world in fog until the map says where it is', () => {
      const fog = createFogBuilder().build(tiles, null);

      expect(fog.geometry.coordinates).toHaveLength(1);
      expect(coverCount(polygonsOf(fog), 121.5654, 25.033)).toBe(1);
      expect(coverCount(polygonsOf(fog), -60, 10)).toBe(1);
    });

    it('does not trace anything while it waits', () => {
      const builder = createFogBuilder();
      builder.build(tiles, null);

      expect(builder.size).toBe(0);
    });

    it('treats a view that makes no sense as no view', () => {
      const builder = createFogBuilder();
      const fog = builder.build(tiles, { ...view, zoom: NaN });

      expect(fog.geometry.coordinates).toHaveLength(1);
      expect(builder.size).toBe(0);
    });

    it('hands back the very same fog while it still has nothing to look at', () => {
      const builder = createFogBuilder();
      const first = builder.build(tiles, null);

      expect(builder.build(reread(tiles), null)).toBe(first);
    });
  });

  describe('looking at some tiles', () => {
    it('draws the tiles in view exactly as the bitmaps say', () => {
      const fog = createFogBuilder().build(tiles, view);

      for (const t of tiles) {
        expect(
          mismatches(polygonsOf(fog), t, 'fogged', { bx0: 0, by0: 0, bx1: 20, by1: 20 }),
        ).toEqual([]);
      }
    });

    it('matches the stateless fog over the ground in view', () => {
      const fog = createFogBuilder().build(tiles, view);
      const stateless = fogFeature(tiles);

      for (const t of tiles) {
        for (let by = 0; by < 20; by++) {
          for (let bx = 0; bx < 20; bx++) {
            const [lon, lat] = cellCentre(t.x, t.y, bx, by);
            expect(coverCount(polygonsOf(fog), lon, lat) > 0).toBe(
              coverCount(polygonsOf(stateless), lon, lat) > 0,
            );
          }
        }
      }
    });

    it('keeps the fog inside a closed loop', () => {
      const loop: TileBitmap = {
        x: HERE.x,
        y: HERE.y,
        bitmap: bitmapFromRows(
          ['#####', '#...#', '#...#', '#...#', '#####'],
          new Uint8Array(BYTES),
          40,
          40,
        ),
      };
      const fog = createFogBuilder().build([loop], viewOf(HERE.x, HERE.y, HERE.x, HERE.y));

      expect(
        mismatches(polygonsOf(fog), loop, 'fogged', { bx0: 38, by0: 38, bx1: 46, by1: 46 }),
      ).toEqual([]);
    });

    it('leaves explored ground well out of view under fog, to be drawn when it comes into view', () => {
      const faraway = tile(HERE.x + 4000, HERE.y + 1000, [[10, 10], [11, 10]]);
      const fog = createFogBuilder().build([...tiles, faraway], view);

      const [lon, lat] = cellCentre(faraway.x, faraway.y, 10, 10);
      expect(coverCount(polygonsOf(fog), lon, lat)).toBe(1);
    });

    it('does not trace tiles that are out of view', () => {
      const builder = createFogBuilder();
      builder.build(
        [
          ...tiles,
          tile(HERE.x + 4000, HERE.y + 1000, [[10, 10]]),
          tile(HERE.x - 900, HERE.y, [[1, 1]]),
        ],
        view,
      );

      expect(builder.size).toBe(2);
    });

    it('draws tiles just outside the screen, so a small drag does not meet fog', () => {
      const beside = tile(HERE.x + 2, HERE.y, [[10, 10]]);
      const fog = createFogBuilder().build([...tiles, beside], view);

      const [lon, lat] = cellCentre(beside.x, beside.y, 10, 10);
      expect(coverCount(polygonsOf(fog), lon, lat)).toBe(0);
    });
  });

  describe('as the view changes', () => {
    it('hands back the same fog while the view stays inside what was drawn', () => {
      const builder = createFogBuilder();
      const first = builder.build(tiles, view);

      const nudged = { ...view, west: view.west + 1e-5, east: view.east + 1e-5 };
      expect(builder.build(tiles, nudged)).toBe(first);
    });

    it('draws again when the view leaves what was drawn', () => {
      const builder = createFogBuilder();
      const first = builder.build(tiles, view);

      const moved = viewOf(HERE.x + 30, HERE.y, HERE.x + 31, HERE.y);
      expect(builder.build(tiles, moved)).not.toBe(first);
    });

    it('draws what has come into view', () => {
      const builder = createFogBuilder();
      const faraway = tile(HERE.x + 30, HERE.y, [[10, 10]]);
      const all = [...tiles, faraway];
      builder.build(all, view);

      const fog = builder.build(all, viewOf(HERE.x + 30, HERE.y, HERE.x + 30, HERE.y));
      const [lon, lat] = cellCentre(faraway.x, faraway.y, 10, 10);
      expect(coverCount(polygonsOf(fog), lon, lat)).toBe(0);
    });

    it('draws again when the tiles are read again, even if nothing in them moved', () => {
      const builder = createFogBuilder();
      const first = builder.build(tiles, view);

      expect(builder.build(reread(tiles), view)).not.toBe(first);
    });

    it('draws again at a coarser grain once the map zooms out past the point of telling cells apart', () => {
      const builder = createFogBuilder();
      const near = builder.build(tiles, view);
      const far = builder.build(tiles, { ...view, zoom: 10 });

      expect(far).not.toBe(near);

      // Zoom 10 groups cells 16 to a block, so a neighbour of an explored cell
      // in the same block is cleared too.
      const [lon, lat] = cellCentre(tiles[1].x, tiles[1].y, 12, 12);
      expect(coverCount(polygonsOf(far), lon, lat)).toBe(0);
      expect(coverCount(polygonsOf(near), lon, lat)).toBe(1);
    });

    it('does not draw again for a change of zoom that keeps the same grain', () => {
      const builder = createFogBuilder();
      const first = builder.build(tiles, { ...view, zoom: 16 });

      expect(builder.build(tiles, { ...view, zoom: 17.5 })).toBe(first);
    });
  });

  describe('remembering what it traced', () => {
    /** The holes and pockets of every polygon that has any, by identity. */
    const ringsOf = (fog: ReturnType<ReturnType<typeof createFogBuilder>['build']>) =>
      fog.geometry.coordinates.flatMap((polygon) => polygon.slice(1));

    it('reuses the rings of a tile that has not changed', () => {
      const builder = createFogBuilder();
      const first = builder.build(tiles, view);
      const second = builder.build(reread(tiles), view);

      // Same ring objects, not merely equal ones: nothing was traced again.
      const before = ringsOf(first);
      const after = ringsOf(second);

      expect(after.length).toBeGreaterThan(0);
      for (const ring of after) expect(before).toContain(ring);
    });

    it('retraces only the tile whose bitmap moved', () => {
      const builder = createFogBuilder();
      const first = builder.build(tiles, view);

      const next = reread(tiles);
      setBit(next[0].bitmap, 40, 40);
      const second = builder.build(next, view);

      // The first tile's rings are new; the second tile's single ring is the
      // same object as before.
      const before = ringsOf(first);
      const after = ringsOf(second);
      const reused = after.filter((ring) => before.includes(ring));
      expect(reused).toHaveLength(1);
      expect(after.length).toBeGreaterThan(1);

      const [lon, lat] = cellCentre(tiles[0].x, tiles[0].y, 40, 40);
      expect(coverCount(polygonsOf(second), lon, lat)).toBe(0);
    });

    it('forgets tiles that are no longer there', () => {
      const builder = createFogBuilder();
      builder.build(tiles, view);
      const shrunk = builder.build([reread(tiles)[1]], view);

      expect(builder.size).toBe(1);

      const [lon, lat] = cellCentre(tiles[0].x, tiles[0].y, 4, 4);
      expect(coverCount(polygonsOf(shrunk), lon, lat)).toBe(1);
    });

    it('holds one entry per tile however often it is rebuilt', () => {
      const builder = createFogBuilder();
      for (let i = 0; i < 5; i++) builder.build(reread(tiles), view);
      expect(builder.size).toBe(2);
    });

    it('keeps what it traced when the view moves on, so coming back costs nothing', () => {
      const builder = createFogBuilder();
      const far = [tile(HERE.x + 30, HERE.y, [[10, 10]])];
      const all = [...tiles, ...far];
      builder.build(all, view);
      builder.build(all, viewOf(HERE.x + 30, HERE.y, HERE.x + 30, HERE.y));

      expect(builder.size).toBe(3);
    });

    it('stops remembering past its limit, keeping what the last build used', () => {
      const builder = createFogBuilder(3);
      const many = Array.from({ length: 6 }, (_, i) => tile(HERE.x + i * 50, HERE.y, [[1, 1]]));

      for (const t of many) {
        builder.build(many, viewOf(t.x, t.y, t.x, t.y));
        expect(builder.size).toBeLessThanOrEqual(3);
      }

      const last = many[many.length - 1];
      const fog = builder.build(many, viewOf(last.x, last.y, last.x, last.y));
      const [lon, lat] = cellCentre(last.x, last.y, 1, 1);
      expect(coverCount(polygonsOf(fog), lon, lat)).toBe(0);
    });
  });
});
