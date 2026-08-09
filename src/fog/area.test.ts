import { describe, expect, test } from 'vitest';
import { exploredSquareMeters } from './area';
import { createTile, setBit } from './bitmap';
import { locationToBit, metersPerBit, TILE_BITS } from './tiles';

function tileWith(cells: number) {
  const bitmap = createTile();
  for (let i = 0; i < cells; i++) setBit(bitmap, i % TILE_BITS, Math.floor(i / TILE_BITS));
  return bitmap;
}

const EQUATOR = locationToBit(0, 0);
const TAIPEI = locationToBit(25.033, 121.5654);
const REYKJAVIK = locationToBit(64.1466, -21.9426);

describe('exploredSquareMeters', () => {
  test('is zero with no tiles', () => {
    expect(exploredSquareMeters([])).toBe(0);
  });

  test('is zero for a tile where nothing was explored', () => {
    expect(exploredSquareMeters([{ x: TAIPEI.x, y: TAIPEI.y, bitmap: createTile() }])).toBe(0);
  });

  test('measures a cell at the equator as about 4.78 m square', () => {
    const area = exploredSquareMeters([{ x: EQUATOR.x, y: EQUATOR.y, bitmap: tileWith(1) }]);

    expect(area).toBeCloseTo(metersPerBit(0) ** 2, 2);
  });

  test('scales with the number of explored cells', () => {
    const one = exploredSquareMeters([{ x: EQUATOR.x, y: EQUATOR.y, bitmap: tileWith(1) }]);
    const hundred = exploredSquareMeters([{ x: EQUATOR.x, y: EQUATOR.y, bitmap: tileWith(100) }]);

    expect(hundred).toBeCloseTo(one * 100, 4);
  });

  test('uses each tile own latitude, so a cell covers less ground further north', () => {
    const taipei = exploredSquareMeters([{ x: TAIPEI.x, y: TAIPEI.y, bitmap: tileWith(100) }]);
    const iceland = exploredSquareMeters([
      { x: REYKJAVIK.x, y: REYKJAVIK.y, bitmap: tileWith(100) },
    ]);

    expect(iceland).toBeLessThan(taipei);
  });

  test('sums across tiles at different latitudes', () => {
    const tiles = [
      { x: TAIPEI.x, y: TAIPEI.y, bitmap: tileWith(50) },
      { x: REYKJAVIK.x, y: REYKJAVIK.y, bitmap: tileWith(50) },
    ];

    const total = exploredSquareMeters(tiles);
    const separately =
      exploredSquareMeters([tiles[0]]) + exploredSquareMeters([tiles[1]]);

    expect(total).toBeCloseTo(separately, 6);
  });

  test('gives the same answer wherever it is asked from', () => {
    // The map panel and the stats screen must never disagree about how much
    // ground has been uncovered.
    const tiles = [{ x: TAIPEI.x, y: TAIPEI.y, bitmap: tileWith(192) }];

    expect(exploredSquareMeters(tiles)).toBe(exploredSquareMeters(tiles));
    expect(exploredSquareMeters(tiles)).toBeGreaterThan(3000);
    expect(exploredSquareMeters(tiles)).toBeLessThan(4000);
  });
});
