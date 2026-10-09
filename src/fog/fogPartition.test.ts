import { describe, expect, test } from 'vitest';
import { createTile, getBit, setBit } from './bitmap';
import { partitionFog, type LiveTile } from './fogPartition';
import { traceTile } from './geojson';
import { cellCentre, coverCount, type Polygon } from './testing/oracle';
import { globalBitToLocation, GRID_TILES, locationToBit, TILE_BITS } from './tiles';

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A tile with a few walks across it, loops and all. */
function walkedTile(seed: number): Uint8Array {
  const next = random(seed);
  const bitmap = createTile();

  for (let walk = 0; walk < 3; walk++) {
    let cx = next() * 128;
    let cy = next() * 128;
    let heading = next() * 6.28;

    for (let step = 0; step < 120; step++) {
      heading += (next() - 0.5) * 0.9;
      cx = Math.min(125, Math.max(2, cx + Math.cos(heading) * 2));
      cy = Math.min(125, Math.max(2, cy + Math.sin(heading) * 2));
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy <= 5) setBit(bitmap, Math.floor(cx) + dx, Math.floor(cy) + dy);
        }
      }
    }
  }

  return bitmap;
}

function live(x: number, y: number, bitmap: Uint8Array, scale = 1): LiveTile {
  return { x, y, trace: traceTile(x, y, bitmap, scale) };
}

describe('partitionFog', () => {
  test('is a single polygon over the whole world when nothing is live', () => {
    const polygons = partitionFog([]);

    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(1);
    expect(coverCount(polygons, 0, 0)).toBe(1);
    expect(coverCount(polygons, 121.5654, 25.033)).toBe(1);
    expect(coverCount(polygons, -179.99, -85)).toBe(1);
    expect(coverCount(polygons, 179.99, 85)).toBe(1);
  });

  test('winds every square clockwise, like the world', () => {
    const [a, b] = [live(100, 200, walkedTile(1)), live(500, 70, walkedTile(2))];

    for (const [exterior] of partitionFog([a, b])) {
      let area = 0;
      for (let i = 0; i < exterior.length - 1; i++) {
        area += exterior[i][0] * exterior[i + 1][1] - exterior[i + 1][0] * exterior[i][1];
      }
      expect(area).toBeLessThan(0);
    }
  });

  test('needs only a few squares to cover everything round one tile', () => {
    const tile = live(40000, 20000, walkedTile(3));
    const polygons = partitionFog([tile]);
    const pockets = tile.trace.pockets.length;

    // One tile, plus at most three siblings for every level of the quadtree.
    expect(polygons.length).toBeLessThanOrEqual(1 + 3 * 16 + pockets);
  });

  test('keeps the number of polygons proportional to the tiles, not the world', () => {
    const tiles = Array.from({ length: 200 }, (_, i) =>
      live(30000 + (i % 20), 15000 + Math.floor(i / 20), walkedTile(i + 10)),
    );
    const pockets = tiles.reduce((total, tile) => total + tile.trace.pockets.length, 0);

    expect(partitionFog(tiles).length).toBeLessThan(200 * 4 + pockets);
  });

  test('leaves no tile with more holes than its own', () => {
    const tiles = [live(100, 100, walkedTile(5)), live(101, 100, walkedTile(6))];
    const mostHoles = Math.max(...tiles.map((tile) => tile.trace.outlines.length));

    for (const [, ...holes] of partitionFog(tiles)) {
      expect(holes.length).toBeLessThanOrEqual(mostHoles);
    }
  });

  /**
   * The property that matters: every point of the world is under the fog
   * exactly once if it is unexplored — never twice, which would show as a
   * darker seam, and never not at all, which would be a hole in the fog — and
   * not at all if it is explored.
   */
  describe.each([
    { scale: 1, points: 'cell' },
    { scale: 16, points: 'block' },
  ])('covers the world exactly once where it is fogged (scale $scale)', ({ scale }) => {
    const bitmaps = [walkedTile(21), walkedTile(22), walkedTile(23)];
    const placed = [
      { x: 30000, y: 18000, bitmap: bitmaps[0] },
      // Right beside the first, so the two share a whole edge.
      { x: 30001, y: 18000, bitmap: bitmaps[1] },
      { x: 12345, y: 40000, bitmap: bitmaps[2] },
    ];
    const tiles = placed.map((p) => live(p.x, p.y, p.bitmap, scale));
    const polygons: Polygon[] = partitionFog(tiles);

    const exploredAt = (lon: number, lat: number): boolean => {
      const { x, y, bx, by } = locationToBit(lat, lon);
      const hit = placed.find((p) => p.x === x && p.y === y);
      if (!hit) return false;

      // A block is explored if any cell in it is.
      const blockX = Math.floor(bx / scale) * scale;
      const blockY = Math.floor(by / scale) * scale;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          if (getBit(hit.bitmap, blockX + dx, blockY + dy)) return true;
        }
      }
      return false;
    };

    const expectedCount = (lon: number, lat: number) => (exploredAt(lon, lat) ? 0 : 1);

    test('across the cells of the tiles themselves, edges included', () => {
      const wrong: string[] = [];

      for (const tile of placed) {
        for (let by = 0; by < TILE_BITS; by += scale === 1 ? 1 : 3) {
          for (let bx = 0; bx < TILE_BITS; bx += scale === 1 ? 1 : 3) {
            // Every cell on the rim, where one tile meets another; a spread inside.
            const onRim = bx < 3 || by < 3 || bx > TILE_BITS - 4 || by > TILE_BITS - 4;
            if (!onRim && (bx * 31 + by * 17) % 5 !== 0) continue;

            const [lon, lat] = cellCentre(tile.x, tile.y, bx, by);
            if (coverCount(polygons, lon, lat) !== expectedCount(lon, lat)) {
              wrong.push(`${tile.x}:${bx},${by}`);
            }
          }
        }
      }

      expect(wrong).toEqual([]);
    });

    test('across the tiles around them and the rest of the world', () => {
      const next = random(77);
      const wrong: string[] = [];

      const check = (lon: number, lat: number) => {
        if (coverCount(polygons, lon, lat) !== expectedCount(lon, lat)) {
          wrong.push(`${lon.toFixed(6)},${lat.toFixed(6)}`);
        }
      };

      // Close to the tiles, where the squares are small and the edges many.
      const near = globalBitToLocation(30000 * TILE_BITS, 18000 * TILE_BITS);
      const far = globalBitToLocation(30030 * TILE_BITS, 18030 * TILE_BITS);
      for (let i = 0; i < 2500; i++) {
        check(
          near.lon + next() * (far.lon - near.lon),
          near.lat + next() * (far.lat - near.lat),
        );
      }

      // And anywhere at all.
      for (let i = 0; i < 1500; i++) {
        check(next() * 359.999 - 179.9995, next() * 169.9 - 84.95);
      }

      expect(wrong).toEqual([]);
    });
  });

  test('has seams that line up exactly, with no gap a point could fall into', () => {
    const tiles = [live(77, 99, walkedTile(31))];
    const polygons = partitionFog(tiles);

    // Walk a line of points straight through the tile's neighbourhood and over
    // every square boundary on the way; each must be covered exactly once.
    const start = globalBitToLocation(70 * TILE_BITS + 0.5, 99.5 * TILE_BITS);
    const end = globalBitToLocation(90 * TILE_BITS + 0.5, 99.5 * TILE_BITS);
    const explored = tiles[0].trace;

    for (let i = 0; i <= 4000; i++) {
      const lon = start.lon + ((end.lon - start.lon) * i) / 4000;
      const count = coverCount(polygons, lon, start.lat);
      const { x } = locationToBit(start.lat, lon);

      if (x !== 77 || explored.outlines.length === 0) expect(count).toBe(1);
      else expect(count).toBeLessThanOrEqual(1);
    }
  });

  test('cuts the world into squares that leave neither a gap nor an overlap', () => {
    // Tiles with no pockets, so every polygon's exterior is one of the squares and
    // their areas must add up to the world's. A sliver missing between two
    // neighbours, or shared by them, moves the total.
    const solid = (cells: Array<[number, number]>) => {
      const bitmap = createTile();
      for (const [bx, by] of cells) setBit(bitmap, bx, by);
      return bitmap;
    };
    const blob: Array<[number, number]> = [[5, 5], [6, 5], [5, 6], [6, 6]];
    const tiles = [
      live(30000, 18000, solid(blob)),
      live(30001, 18000, solid(blob)),
      live(30000, 18001, solid(blob)),
      live(61000, 100, solid(blob)),
      live(0, 0, solid(blob)),
      live(GRID_TILES - 1, GRID_TILES - 1, solid(blob)),
    ];

    const polygons = partitionFog(tiles);
    expect(polygons.every((polygon) => polygon.length >= 1)).toBe(true);

    let total = 0;
    for (const [exterior] of polygons) {
      let twice = 0;
      for (let i = 0; i < exterior.length - 1; i++) {
        twice += exterior[i][0] * exterior[i + 1][1] - exterior[i + 1][0] * exterior[i][1];
      }
      total += Math.abs(twice) / 2;
    }

    const top = globalBitToLocation(0, 0).lat;
    const bottom = globalBitToLocation(GRID_TILES * TILE_BITS, GRID_TILES * TILE_BITS).lat;
    expect(total).toBeCloseTo(360 * (top - bottom), 6);
  });

  test('stays within the world grid', () => {
    const edge = live(GRID_TILES - 1, GRID_TILES - 1, walkedTile(40));
    const corner = live(0, 0, walkedTile(41));

    expect(() => partitionFog([edge, corner])).not.toThrow();
  });
});
