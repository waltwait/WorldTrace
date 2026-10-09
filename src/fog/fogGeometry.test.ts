import { describe, expect, it } from 'vitest';
import { setBit } from './bitmap';
import { fogFeature, type TileBitmap } from './geojson';
import { createFogBuilder, HOT_TILES } from './fogGeometry';
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
      const away = tile(HERE.x + 8, HERE.y, [[9, 9]]);
      const ground = [...tiles, away];
      const builder = createFogBuilder();
      const near = builder.build(ground, viewOf(HERE.x, HERE.y, HERE.x + 8, HERE.y));
      const far = builder.build(ground, viewOf(HERE.x - 6, HERE.y - 6, HERE.x + 6, HERE.y + 6, 10));

      expect(far).not.toBe(near);

      // Zoom 10 groups cells 16 to a block, so a neighbour of an explored cell in
      // the same block is cleared too — on a tile away from the middle, where
      // the grain follows the zoom. (The middle keeps full detail; see below.)
      const [lon, lat] = cellCentre(away.x, away.y, 12, 12);
      expect(coverCount(polygonsOf(far), lon, lat)).toBe(0);
      expect(coverCount(polygonsOf(near), lon, lat)).toBe(1);
    });

    it('does not draw again for a change of zoom that keeps the same grain', () => {
      const builder = createFogBuilder();
      const first = builder.build(tiles, { ...view, zoom: 16 });

      expect(builder.build(tiles, { ...view, zoom: 17.5 })).toBe(first);
    });
  });

  /**
   * Zoomed out, tiles are traced in coarse blocks, and a coarse block clears if
   * any cell in it is explored. Zoom in fast and those blocks are magnified into
   * a bright, blocky patch of map that was never walked, which stays until the
   * map has stopped and the fog has been redrawn. Zooming in almost always goes
   * towards the middle of the screen, so the tiles there are kept at full
   * detail already: nothing is left to catch up with when the zoom arrives.
   */
  describe('keeping detail where a zoom is about to land', () => {
    // Zoom 10 traces in blocks of 16 cells, so (12, 12) shares a block with (4, 4).
    const walked = (x: number, y: number) => tile(x, y, [[4, 4]]);
    const farView = (x: number, y: number, half = 10) =>
      viewOf(x - half, y - half, x + half, y + half, 10);
    const fogAtSameBlock = (fog: ReturnType<ReturnType<typeof createFogBuilder>['build']>, t: TileBitmap) => {
      const [lon, lat] = cellCentre(t.x, t.y, 12, 12);
      return coverCount(polygonsOf(fog), lon, lat);
    };

    it('traces the tile at the middle of a zoomed-out view cell by cell', () => {
      const middle = walked(HERE.x, HERE.y);
      const fog = createFogBuilder().build([middle], farView(HERE.x, HERE.y));

      expect(fogAtSameBlock(fog, middle)).toBe(1);
    });

    it('still traces tiles far from the middle in coarse blocks', () => {
      const middle = walked(HERE.x, HERE.y);
      const away = walked(HERE.x + 8, HERE.y);
      const fog = createFogBuilder().build([middle, away], farView(HERE.x, HERE.y));

      expect(fogAtSameBlock(fog, away)).toBe(0);
    });

    it('keeps coarse blocks in their place, so the walked cell itself is clear either way', () => {
      const middle = walked(HERE.x, HERE.y);
      const away = walked(HERE.x + 8, HERE.y);
      const fog = createFogBuilder().build([middle, away], farView(HERE.x, HERE.y));

      for (const t of [middle, away]) {
        const [lon, lat] = cellCentre(t.x, t.y, 4, 4);
        expect(coverCount(polygonsOf(fog), lon, lat)).toBe(0);
      }
    });

    it('keeps full detail for no more tiles than it can afford, nearest the middle first', () => {
      const grid: TileBitmap[] = [];
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) grid.push(walked(HERE.x + dx, HERE.y + dy));
      }
      const fog = createFogBuilder().build(grid, farView(HERE.x, HERE.y, 6));

      const detailed = grid.filter((t) => fogAtSameBlock(fog, t) === 1);
      expect(detailed.length).toBeGreaterThan(0);
      expect(detailed.length).toBeLessThanOrEqual(HOT_TILES);

      // Within reach of the middle in every direction, but not all of them fit:
      // the middle and its neighbours do, the far corner of the square does not.
      const has = (dx: number, dy: number) =>
        detailed.some((t) => t.x === HERE.x + dx && t.y === HERE.y + dy);
      expect(has(0, 0)).toBe(true);
      expect(has(1, 1)).toBe(true);
      expect(has(-1, 0)).toBe(true);
      expect(has(3, 3)).toBe(false);
      expect(has(-3, -3)).toBe(false);
    });

    it('has nothing extra to keep once every tile is traced in full anyway', () => {
      const middle = walked(HERE.x, HERE.y);
      const ground = [middle];
      const builder = createFogBuilder();
      builder.build(ground, viewOf(HERE.x, HERE.y, HERE.x, HERE.y, 16));

      expect(builder.isCurrent(ground, viewOf(HERE.x, HERE.y, HERE.x, HERE.y, 16.5))).toBe(true);
    });

    it('redraws when the middle of the view has moved on, so the detail goes with it', () => {
      const ground = [walked(HERE.x, HERE.y)];
      const builder = createFogBuilder();
      builder.build(ground, farView(HERE.x, HERE.y));

      // Still well inside what was drawn, but the detail is no longer in the middle.
      expect(builder.isCurrent(ground, farView(HERE.x + 5, HERE.y))).toBe(false);
    });

    it('does not redraw for a nudge that leaves the detail where it is needed', () => {
      const ground = [walked(HERE.x, HERE.y)];
      const builder = createFogBuilder();
      builder.build(ground, farView(HERE.x, HERE.y));

      expect(builder.isCurrent(ground, farView(HERE.x + 1, HERE.y))).toBe(true);
    });

    it('follows the middle: the tile it moves to is traced in full', () => {
      const other = walked(HERE.x + 6, HERE.y);
      const ground = [walked(HERE.x, HERE.y), other];
      const builder = createFogBuilder();
      builder.build(ground, farView(HERE.x, HERE.y));
      const fog = builder.build(ground, farView(HERE.x + 6, HERE.y));

      expect(fogAtSameBlock(fog, other)).toBe(1);
    });

    it('agrees with build about whether a redraw is due', () => {
      const ground = [walked(HERE.x, HERE.y)];
      const builder = createFogBuilder();

      for (const dx of [0, 1, 2, 3, 5, 8, 0]) {
        const v = farView(HERE.x + dx, HERE.y);
        const due = !builder.isCurrent(ground, v);
        const fog = builder.build(ground, v);

        // After building, a second ask and a second build must both say "same".
        expect(builder.isCurrent(ground, v)).toBe(true);
        expect(builder.build(ground, v)).toBe(fog);
        if (!due) expect(builder.build(ground, v)).toBe(fog);
      }
    });
  });

  describe('knowing when a redraw is due', () => {
    it('is due before anything has been drawn', () => {
      expect(createFogBuilder().isCurrent(tiles, view)).toBe(false);
      expect(createFogBuilder().isCurrent(tiles, null)).toBe(false);
    });

    it('is not due for the view it just drew', () => {
      const builder = createFogBuilder();
      builder.build(tiles, view);

      expect(builder.isCurrent(tiles, view)).toBe(true);
    });

    it('is not due while the view stays inside what was drawn', () => {
      const builder = createFogBuilder();
      builder.build(tiles, view);

      expect(builder.isCurrent(tiles, { ...view, west: view.west + 1e-5 })).toBe(true);
    });

    it('is due once the view leaves what was drawn', () => {
      const builder = createFogBuilder();
      builder.build(tiles, view);

      expect(builder.isCurrent(tiles, viewOf(HERE.x + 30, HERE.y, HERE.x + 31, HERE.y))).toBe(false);
    });

    it('is due when zooming crosses into a finer grain, before the map has stopped', () => {
      const builder = createFogBuilder();
      builder.build(tiles, { ...view, zoom: 10 });

      // Zoom 10 and 9.5 trace in blocks of 16; 10.5 is a level finer, in blocks of 8.
      expect(builder.isCurrent(tiles, { ...view, zoom: 10.5 })).toBe(false);
      expect(builder.isCurrent(tiles, { ...view, zoom: 13.5 })).toBe(false);
      expect(builder.isCurrent(tiles, { ...view, zoom: 9.5 })).toBe(true);
    });

    it('is due when the tiles have been read again', () => {
      const builder = createFogBuilder();
      builder.build(tiles, view);

      expect(builder.isCurrent(reread(tiles), view)).toBe(false);
    });

    it('is not due for a view that makes no sense, once the world is covered', () => {
      const builder = createFogBuilder();
      builder.build(tiles, null);

      expect(builder.isCurrent(tiles, null)).toBe(true);
      expect(builder.isCurrent(tiles, { ...view, zoom: NaN })).toBe(true);
    });

    it('changes nothing by being asked', () => {
      const builder = createFogBuilder();
      const first = builder.build(tiles, view);
      const asked = [view, viewOf(HERE.x + 30, HERE.y, HERE.x + 31, HERE.y), null];
      for (const v of asked) builder.isCurrent(tiles, v);

      expect(builder.build(tiles, view)).toBe(first);
      expect(builder.size).toBe(2);
    });

    it('agrees with build about whether it will hand back the same fog', () => {
      const builder = createFogBuilder();
      const views = [
        view,
        { ...view, west: view.west + 1e-5 },
        viewOf(HERE.x + 30, HERE.y, HERE.x + 31, HERE.y),
        { ...view, zoom: 10 },
        { ...view, zoom: 10.5 },
        { ...view, zoom: 16 },
        view,
      ];

      for (const v of views) {
        const before = builder.build(tiles, v);
        const predicted = builder.isCurrent(tiles, v);
        expect(predicted).toBe(true);
        expect(builder.build(tiles, v)).toBe(before);
      }
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
