import { beforeEach, describe, expect, test } from 'vitest';
import { createTile, setBit } from '../fog/bitmap';
import { FOG_ZOOM } from '../fog/tiles';
import type { SqlDriver } from './driver';
import { getFogTilesSignature, loadAllTiles } from './fogTiles';
import { migrate } from './schema';
import { createNodeDriver } from './testing/nodeDriver';

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
});

describe('getFogTilesSignature', () => {
  test('returns 0 count and null timestamp when empty', () => {
    return expect(getFogTilesSignature(driver)).resolves.toEqual({
      count: 0,
      lastUpdated: null,
    });
  });

  test('reports count and latest updated_at', async () => {
    const tile = createTile();
    setBit(tile, 1, 1);

    await driver.run(
      'INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (?, ?, ?, ?, ?)',
      [FOG_ZOOM, 100, 200, tile, 1000],
    );
    await driver.run(
      'INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (?, ?, ?, ?, ?)',
      [FOG_ZOOM, 101, 200, tile, 2500],
    );

    const sig = await getFogTilesSignature(driver);
    expect(sig).toEqual({
      count: 2,
      lastUpdated: 2500,
    });
  });
});

describe('loadAllTiles', () => {
  test('returns empty array when no tiles exist', () => {
    return expect(loadAllTiles(driver)).resolves.toEqual([]);
  });

  test('loads all tiles ordered by y, x', async () => {
    const tileA = createTile();
    setBit(tileA, 5, 5);
    const tileB = createTile();
    setBit(tileB, 10, 10);

    await driver.run(
      'INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (?, ?, ?, ?, ?)',
      [FOG_ZOOM, 105, 200, tileB, 2000],
    );
    await driver.run(
      'INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (?, ?, ?, ?, ?)',
      [FOG_ZOOM, 100, 200, tileA, 1000],
    );

    const loaded = await loadAllTiles(driver);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].x).toBe(100);
    expect(loaded[1].x).toBe(105);
  });
});

