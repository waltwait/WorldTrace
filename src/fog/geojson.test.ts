import { describe, expect, test } from 'vitest';
import { createTile, getBit, setBit } from './bitmap';
import { exploredRings, exploredFeature, fogFeature, traceTile } from './geojson';
import { bitmapFromRows, cellCentre, covers, mismatches, polygonsOf } from './testing/oracle';
import { locationToBit, locationToGlobalBit, globalBitToLocation, TILE_BITS } from './tiles';

const TAIPEI = { lat: 25.033, lon: 121.5654 };
const TILE = locationToBit(TAIPEI.lat, TAIPEI.lon);

describe('exploredRings', () => {
  test('produces nothing for a fully fogged tile', () => {
    expect(exploredRings(TILE.x, TILE.y, createTile())).toEqual([]);
  });

  test('produces one ring for one explored cell', () => {
    const tile = createTile();
    setBit(tile, 10, 20);

    const rings = exploredRings(TILE.x, TILE.y, tile);

    expect(rings).toHaveLength(1);
    // A closed rectangle: five positions, first equal to last.
    expect(rings[0]).toHaveLength(5);
    expect(rings[0][0]).toEqual(rings[0][4]);
  });

  test('merges a horizontal run into a single ring', () => {
    const tile = createTile();
    for (let bx = 10; bx < 30; bx++) setBit(tile, bx, 20);

    expect(exploredRings(TILE.x, TILE.y, tile)).toHaveLength(1);
  });

  test('keeps separate runs on the same row apart', () => {
    const tile = createTile();
    setBit(tile, 10, 20);
    setBit(tile, 50, 20);

    expect(exploredRings(TILE.x, TILE.y, tile)).toHaveLength(2);
  });

  test('merges matching vertical runs across adjacent rows into a single ring', () => {
    const tile = createTile();
    setBit(tile, 10, 20);
    setBit(tile, 10, 21);

    expect(exploredRings(TILE.x, TILE.y, tile)).toHaveLength(1);
  });

  test('merges L-shaped connected path into a single unified ring', () => {
    const tile = createTile();
    setBit(tile, 10, 20);
    setBit(tile, 10, 21);
    setBit(tile, 11, 21);

    expect(exploredRings(TILE.x, TILE.y, tile)).toHaveLength(1);
  });

  test('merges circular brush stamp into a single unified ring', () => {
    const tile = createTile();
    const cx = 50;
    const cy = 50;
    const radius = 4;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          setBit(tile, cx + dx, cy + dy);
        }
      }
    }

    const rings = exploredRings(TILE.x, TILE.y, tile);
    expect(rings).toHaveLength(1);
  });

  test('places the ring at the cell it came from', () => {
    const tile = createTile();
    setBit(tile, TILE.bx, TILE.by);

    const [ring] = exploredRings(TILE.x, TILE.y, tile);
    const lons = ring.map(([lon]) => lon);
    const lats = ring.map(([, lat]) => lat);

    expect(Math.min(...lons)).toBeLessThanOrEqual(TAIPEI.lon);
    expect(Math.max(...lons)).toBeGreaterThanOrEqual(TAIPEI.lon);
    expect(Math.min(...lats)).toBeLessThanOrEqual(TAIPEI.lat);
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(TAIPEI.lat);
  });

  test('winds the ring counter-clockwise as GeoJSON requires for an exterior ring', () => {
    const tile = createTile();
    setBit(tile, 10, 20);

    const [ring] = exploredRings(TILE.x, TILE.y, tile);

    // Shoelace: positive area means counter-clockwise in lon/lat space.
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    expect(area).toBeGreaterThan(0);
  });

  test('spans the full width of the tile when every cell in a row is explored', () => {
    const tile = createTile();
    for (let bx = 0; bx < TILE_BITS; bx++) setBit(tile, bx, 0);

    const [ring] = exploredRings(TILE.x, TILE.y, tile);
    const lons = ring.map(([lon]) => lon);

    const left = globalBitToLocation(TILE.x * TILE_BITS, TILE.y * TILE_BITS);
    const right = globalBitToLocation((TILE.x + 1) * TILE_BITS, TILE.y * TILE_BITS);

    expect(Math.min(...lons)).toBeCloseTo(left.lon, 9);
    expect(Math.max(...lons)).toBeCloseTo(right.lon, 9);
  });
});

describe('exploredFeature', () => {
  test('is null when nothing has been explored', () => {
    expect(exploredFeature([{ x: TILE.x, y: TILE.y, bitmap: createTile() }])).toBeNull();
  });

  test('collects every tile into one MultiPolygon', () => {
    const a = createTile();
    setBit(a, 10, 20);
    const b = createTile();
    setBit(b, 30, 40);

    const feature = exploredFeature([
      { x: TILE.x, y: TILE.y, bitmap: a },
      { x: TILE.x + 1, y: TILE.y, bitmap: b },
    ]);

    expect(feature?.geometry.type).toBe('MultiPolygon');
    expect(feature?.geometry.coordinates).toHaveLength(2);
  });

  test('wraps each ring as its own polygon with no holes', () => {
    const tile = createTile();
    setBit(tile, 10, 20);

    const feature = exploredFeature([{ x: TILE.x, y: TILE.y, bitmap: tile }]);

    expect(feature?.geometry.coordinates[0]).toHaveLength(1);
  });

  test('leaves the pocket of a closed loop out as a hole in the loop', () => {
    const bitmap = bitmapFromRows(
      ['#####', '#...#', '#...#', '#...#', '#####'],
      createTile(),
      40,
      40,
    );
    const tile = { x: TILE.x, y: TILE.y, bitmap };
    const feature = exploredFeature([tile]);

    expect(feature?.geometry.coordinates).toHaveLength(1);
    expect(feature?.geometry.coordinates[0]).toHaveLength(2);
    expect(
      mismatches(polygonsOf(feature!), tile, 'explored', {
        bx0: 38,
        by0: 38,
        bx1: 46,
        by1: 46,
      }),
    ).toEqual([]);
  });

  test('draws ground inside a pocket as a polygon of its own', () => {
    const bitmap = bitmapFromRows(
      ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'],
      createTile(),
      40,
      40,
    );
    const tile = { x: TILE.x, y: TILE.y, bitmap };
    const feature = exploredFeature([tile]);

    expect(feature?.geometry.coordinates).toHaveLength(2);
    expect(
      mismatches(polygonsOf(feature!), tile, 'explored', {
        bx0: 38,
        by0: 38,
        bx1: 48,
        by1: 48,
      }),
    ).toEqual([]);
  });
});

describe('traceTile', () => {
  const trace = (rows: string[], bx = 30, by = 30) =>
    traceTile(TILE.x, TILE.y, bitmapFromRows(rows, createTile(), bx, by));

  test('has nothing to say about a fully fogged tile', () => {
    expect(traceTile(TILE.x, TILE.y, createTile())).toEqual({ outlines: [], pockets: [] });
  });

  test('gives solid ground an outline and no pockets', () => {
    const { outlines, pockets } = trace(['###', '###']);

    expect(outlines).toHaveLength(1);
    expect(pockets).toEqual([]);
  });

  test('finds the pocket a closed loop leaves', () => {
    const { outlines, pockets } = trace(['#####', '#...#', '#...#', '#...#', '#####']);

    expect(outlines).toHaveLength(1);
    expect(pockets).toHaveLength(1);
    // Just the boundary: nothing stands inside it.
    expect(pockets[0]).toHaveLength(1);
  });

  test('puts ground that stands inside a pocket in that pocket, not the tile', () => {
    const { outlines, pockets } = trace([
      '#######',
      '#.....#',
      '#.###.#',
      '#.###.#',
      '#.###.#',
      '#.....#',
      '#######',
    ]);

    expect(outlines).toHaveLength(1);
    expect(pockets).toHaveLength(1);
    // The boundary of the pocket, then the island of ground standing in it.
    expect(pockets[0]).toHaveLength(2);
  });

  test('nests as deep as the ground does', () => {
    const { outlines, pockets } = trace([
      '#########',
      '#.......#',
      '#.#####.#',
      '#.#...#.#',
      '#.#.#.#.#',
      '#.#...#.#',
      '#.#####.#',
      '#.......#',
      '#########',
    ]);

    expect(outlines).toHaveLength(1);
    expect(pockets).toHaveLength(2);
    expect(pockets.map((pocket) => pocket.length).sort()).toEqual([2, 2]);
  });

  test('keeps pockets apart that share a wall', () => {
    const { outlines, pockets } = trace(['#######', '#..#..#', '#..#..#', '#######']);

    expect(outlines).toHaveLength(1);
    expect(pockets).toHaveLength(2);
  });

  test('closes every ring it returns', () => {
    const { outlines, pockets } = trace(['#####', '#...#', '#.#.#', '#...#', '#####']);

    for (const ring of [...outlines, ...pockets.flat()]) {
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  test('winds outlines counter-clockwise and pockets clockwise', () => {
    const shoelace = (ring: [number, number][]) => {
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      return area;
    };

    const { outlines, pockets } = trace(['#####', '#...#', '#.#.#', '#...#', '#####']);

    expect(shoelace(outlines[0])).toBeGreaterThan(0);
    expect(shoelace(pockets[0][0])).toBeLessThan(0);
    expect(shoelace(pockets[0][1])).toBeGreaterThan(0);
  });
});

/**
 * Zoomed out, a tile is a few pixels across and its 16 384 cells are far finer
 * than anything the screen can show. Tracing it on a coarser grid costs a
 * fraction as much, and the cost of getting it wrong is lopsided: ground drawn
 * cleared that was not walked is a lie, but ground drawn fogged that was walked
 * is a gap in the record. A block therefore clears if *any* cell in it is
 * explored — never the other way round.
 */
describe('traceTile at a coarser scale', () => {
  const SCALES = [2, 4, 8, 16, 32, 64, 128];

  const tileAt = (cells: Array<[number, number]>) => {
    const bitmap = createTile();
    for (const [bx, by] of cells) setBit(bitmap, bx, by);
    return bitmap;
  };

  test('clears the whole block around a single explored cell', () => {
    const [outline] = traceTile(TILE.x, TILE.y, tileAt([[10, 20]]), 8).outlines;

    const lons = outline.map(([lon]) => lon);
    const lats = outline.map(([, lat]) => lat);
    const originX = TILE.x * TILE_BITS;
    const originY = TILE.y * TILE_BITS;
    const topLeft = globalBitToLocation(originX + 8, originY + 16);
    const bottomRight = globalBitToLocation(originX + 16, originY + 24);

    expect(Math.min(...lons)).toBeCloseTo(topLeft.lon, 9);
    expect(Math.max(...lons)).toBeCloseTo(bottomRight.lon, 9);
    expect(Math.max(...lats)).toBeCloseTo(topLeft.lat, 9);
    expect(Math.min(...lats)).toBeCloseTo(bottomRight.lat, 9);
  });

  test('at scale 1 is the tile as it is', () => {
    const bitmap = tileAt([[10, 20], [11, 20], [11, 21]]);

    expect(traceTile(TILE.x, TILE.y, bitmap, 1)).toEqual(traceTile(TILE.x, TILE.y, bitmap));
  });

  test('turns the whole tile into one block at the coarsest scale', () => {
    const { outlines, pockets } = traceTile(TILE.x, TILE.y, tileAt([[3, 100]]), TILE_BITS);

    expect(pockets).toEqual([]);
    expect(outlines).toHaveLength(1);
    expect(outlines[0]).toHaveLength(5);

    const west = globalBitToLocation(TILE.x * TILE_BITS, TILE.y * TILE_BITS);
    const east = globalBitToLocation((TILE.x + 1) * TILE_BITS, (TILE.y + 1) * TILE_BITS);
    const lons = outlines[0].map(([lon]) => lon);
    const lats = outlines[0].map(([, lat]) => lat);
    expect(Math.min(...lons)).toBeCloseTo(west.lon, 9);
    expect(Math.max(...lons)).toBeCloseTo(east.lon, 9);
    expect(Math.max(...lats)).toBeCloseTo(west.lat, 9);
    expect(Math.min(...lats)).toBeCloseTo(east.lat, 9);
  });

  test('never leaves explored ground fogged, whatever the scale', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const bitmap = createTile();
    for (let i = 0; i < 600; i++) setBit(bitmap, Math.floor(random() * 128), Math.floor(random() * 128));
    const tile = { x: TILE.x, y: TILE.y, bitmap };

    for (const scale of SCALES) {
      const { outlines, pockets } = traceTile(tile.x, tile.y, bitmap, scale);
      const west = globalBitToLocation(tile.x * TILE_BITS, tile.y * TILE_BITS);
      const east = globalBitToLocation((tile.x + 1) * TILE_BITS, (tile.y + 1) * TILE_BITS);
      const square: [number, number][] = [
        [west.lon, east.lat],
        [west.lon, west.lat],
        [east.lon, west.lat],
        [east.lon, east.lat],
        [west.lon, east.lat],
      ];
      const fog = [[square, ...outlines], ...pockets];

      const hidden: string[] = [];
      for (let by = 0; by < 128; by++) {
        for (let bx = 0; bx < 128; bx++) {
          if (!getBit(bitmap, bx, by)) continue;
          const [lon, lat] = cellCentre(tile.x, tile.y, bx, by);
          if (covers(fog, lon, lat)) hidden.push(`${bx},${by}`);
        }
      }

      expect(hidden, `scale ${scale}`).toEqual([]);
    }
  });

  test('clears exactly the blocks that hold explored ground', () => {
    let seed = 99;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const bitmap = createTile();
    for (let i = 0; i < 300; i++) setBit(bitmap, Math.floor(random() * 128), Math.floor(random() * 128));

    for (const scale of [4, 16]) {
      const { outlines, pockets } = traceTile(TILE.x, TILE.y, bitmap, scale);
      const west = globalBitToLocation(TILE.x * TILE_BITS, TILE.y * TILE_BITS);
      const east = globalBitToLocation((TILE.x + 1) * TILE_BITS, (TILE.y + 1) * TILE_BITS);
      const square: [number, number][] = [
        [west.lon, east.lat],
        [west.lon, west.lat],
        [east.lon, west.lat],
        [east.lon, east.lat],
        [west.lon, east.lat],
      ];
      const fog = [[square, ...outlines], ...pockets];

      const wrong: string[] = [];
      for (let blockY = 0; blockY < 128 / scale; blockY++) {
        for (let blockX = 0; blockX < 128 / scale; blockX++) {
          let held = false;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              if (getBit(bitmap, blockX * scale + dx, blockY * scale + dy)) held = true;
            }
          }

          // Any cell of the block will do: the block clears or fogs as one.
          const [lon, lat] = cellCentre(TILE.x, TILE.y, blockX * scale, blockY * scale);
          if (covers(fog, lon, lat) === held) wrong.push(`${blockX},${blockY}`);
        }
      }

      expect(wrong, `scale ${scale}`).toEqual([]);
    }
  });
});

describe('fogFeature', () => {
  test('covers the whole world when nothing has been explored', () => {
    const feature = fogFeature([]);
    const [world] = feature.geometry.coordinates;
    const [exterior] = world;
    const lons = exterior.map(([lon]) => lon);
    const lats = exterior.map(([, lat]) => lat);

    expect(feature.geometry.coordinates).toHaveLength(1);
    expect(world).toHaveLength(1);
    expect(Math.min(...lons)).toBeLessThanOrEqual(-180);
    expect(Math.max(...lons)).toBeGreaterThanOrEqual(180);
    expect(Math.min(...lats)).toBeLessThanOrEqual(-85);
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(85);
  });

  test('punches an explored cell out as a hole', () => {
    const tile = createTile();
    setBit(tile, 10, 20);

    const feature = fogFeature([{ x: TILE.x, y: TILE.y, bitmap: tile }]);

    const [world] = feature.geometry.coordinates;
    expect(world).toHaveLength(2);
    expect(world[1]).toEqual(exploredRings(TILE.x, TILE.y, tile)[0]);
  });

  test('winds the exterior clockwise, opposite to the holes', () => {
    const shoelace = (ring: [number, number][]) => {
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      return area;
    };

    const tile = createTile();
    setBit(tile, 10, 20);
    const feature = fogFeature([{ x: TILE.x, y: TILE.y, bitmap: tile }]);

    const [world] = feature.geometry.coordinates;
    expect(shoelace(world[0])).toBeLessThan(0);
    expect(shoelace(world[1])).toBeGreaterThan(0);
  });

  test('punches out every run across every tile', () => {
    const a = createTile();
    setBit(a, 10, 20);
    setBit(a, 50, 20);
    const b = createTile();
    setBit(b, 30, 40);

    const feature = fogFeature([
      { x: TILE.x, y: TILE.y, bitmap: a },
      { x: TILE.x + 1, y: TILE.y, bitmap: b },
    ]);

    // The world, then three separate runs punched out of it.
    expect(feature.geometry.coordinates).toHaveLength(1);
    expect(feature.geometry.coordinates[0]).toHaveLength(4);
  });

  test('dramatically reduces hole count on realistic winding paths', () => {
    const tile = createTile();
    // Simulate a continuous winding path of 100 circular stamps of radius 4 (diameter 9)
    for (let step = 0; step < 100; step++) {
      const cx = Math.floor(64 + 40 * Math.sin(step / 10));
      const cy = Math.floor(64 + 40 * Math.cos(step / 15));
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          if (dx * dx + dy * dy <= 16) {
            setBit(tile, cx + dx, cy + dy);
          }
        }
      }
    }

    const t0 = performance.now();
    const rings = exploredRings(TILE.x, TILE.y, tile);
    const duration = performance.now() - t0;

    console.log(`[CONTOUR STATS] Continuous winding path produced ${rings.length} rings in ${duration.toFixed(2)}ms!`);
    // A single continuous winding path merges into just 1 or 2 connected boundary rings!
    expect(rings.length).toBeLessThanOrEqual(3);
  });
});

/**
 * What the fog covers has to be exactly what the bitmap says is unexplored.
 * These read the geometry back cell by cell instead of counting rings, because
 * a mask that clears ground nobody walked still has a perfectly plausible
 * number of rings.
 */
describe('fogFeature against the bitmap', () => {
  function foggedWrongly(
    rows: string[],
    at: { bx: number; by: number },
    margin = 2,
  ): string[] {
    const bitmap = bitmapFromRows(rows, createTile(), at.bx, at.by);
    const tile = { x: TILE.x, y: TILE.y, bitmap };

    return mismatches(polygonsOf(fogFeature([tile])), tile, 'fogged', {
      bx0: Math.max(0, at.bx - margin),
      by0: Math.max(0, at.by - margin),
      bx1: Math.min(TILE_BITS - 1, at.bx + rows[0].length - 1 + margin),
      by1: Math.min(TILE_BITS - 1, at.by + rows.length - 1 + margin),
    });
  }

  test('keeps the ground inside a closed loop fogged', () => {
    // The route walks round a block and never crosses the middle of it.
    expect(
      foggedWrongly(['#####', '#...#', '#...#', '#...#', '#####'], { bx: 40, by: 40 }),
    ).toEqual([]);
  });

  test('keeps explored ground inside the pocket of a loop explored', () => {
    expect(
      foggedWrongly(
        [
          '#########',
          '#.......#',
          '#.#####.#',
          '#.#...#.#',
          '#.#.#.#.#',
          '#.#...#.#',
          '#.#####.#',
          '#.......#',
          '#########',
        ],
        { bx: 30, by: 30 },
      ),
    ).toEqual([]);
  });

  test('leaves a pocket fogged however many of them one loop holds', () => {
    expect(
      foggedWrongly(['#######', '#..#..#', '#..#..#', '#######'], { bx: 60, by: 60 }),
    ).toEqual([]);
  });

  test('treats cells that touch only at a corner as the separate ground they are', () => {
    expect(foggedWrongly(['#.', '.#'], { bx: 70, by: 70 })).toEqual([]);
    expect(foggedWrongly(['.#', '#.'], { bx: 70, by: 70 })).toEqual([]);
  });

  test('keeps a pocket pinched shut at a corner fogged', () => {
    expect(
      foggedWrongly(['#####', '#.#.#', '##.##', '#.#.#', '#####'], { bx: 20, by: 90 }),
    ).toEqual([]);
  });

  test('keeps a loop that runs along the edge of the tile fogged inside', () => {
    expect(foggedWrongly(['####', '#..#', '#..#', '####'], { bx: 0, by: 0 })).toEqual([]);
    expect(
      foggedWrongly(['####', '#..#', '#..#', '####'], { bx: TILE_BITS - 4, by: TILE_BITS - 4 }),
    ).toEqual([]);
  });

  test('matches the bitmap on scattered ground of every density', () => {
    for (const density of [0.2, 0.45, 0.55, 0.7, 0.9]) {
      let seed = Math.round(density * 1000);
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };

      const rows = Array.from({ length: 26 }, () =>
        Array.from({ length: 26 }, () => (random() < density ? '#' : '.')).join(''),
      );

      expect(foggedWrongly(rows, { bx: 30, by: 30 }), `density ${density}`).toEqual([]);
    }
  });

  test('matches the bitmap on a winding path that crosses itself', () => {
    const bitmap = createTile();
    for (let step = 0; step < 100; step++) {
      const cx = Math.floor(64 + 40 * Math.sin(step / 10));
      const cy = Math.floor(64 + 40 * Math.cos(step / 15));
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          if (dx * dx + dy * dy <= 16) setBit(bitmap, cx + dx, cy + dy);
        }
      }
    }

    const tile = { x: TILE.x, y: TILE.y, bitmap };
    const wrong = mismatches(polygonsOf(fogFeature([tile])), tile, 'fogged', {
      bx0: 0,
      by0: 0,
      bx1: TILE_BITS - 1,
      by1: TILE_BITS - 1,
    });

    expect(wrong).toEqual([]);
  });
});
