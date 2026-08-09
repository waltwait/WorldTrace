import { beforeEach, describe, expect, test } from 'vitest';
import { createTile, setBit } from '../fog/bitmap';
import type { SqlDriver } from './driver';
import { countPlaces, listPlaces, recordPlace, unresolvedTiles } from './places';
import { migrate } from './schema';
import { createNodeDriver } from './testing/nodeDriver';

const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
});

async function exploredTile(x: number, y: number) {
  const bitmap = createTile();
  setBit(bitmap, 0, 0);
  await driver.run('INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (16, ?, ?, ?, ?)', [
    x,
    y,
    bitmap,
    NOW,
  ]);
}

describe('unresolvedTiles', () => {
  test('is empty before anything has been explored', async () => {
    expect(await unresolvedTiles(driver, 10)).toEqual([]);
  });

  test('offers an explored tile that has never been looked up', async () => {
    await exploredTile(55000, 28000);

    expect(await unresolvedTiles(driver, 10)).toEqual([{ x: 55000, y: 28000 }]);
  });

  test('does not offer a tile that has already been resolved', async () => {
    await exploredTile(55000, 28000);
    await recordPlace(driver, { x: 55000, y: 28000 }, { country: '台灣', city: '新竹市' }, NOW);

    expect(await unresolvedTiles(driver, 10)).toEqual([]);
  });

  test('does not retry a tile that came back with nothing', async () => {
    // Otherwise every pass would spend its whole quota on the same stretch of
    // sea, and the tiles behind it would never be reached.
    await exploredTile(55000, 28000);
    await recordPlace(driver, { x: 55000, y: 28000 }, { country: null, city: null }, NOW);

    expect(await unresolvedTiles(driver, 10)).toEqual([]);
  });

  test('never offers more than asked for', async () => {
    for (let i = 0; i < 25; i++) await exploredTile(55000 + i, 28000);

    expect(await unresolvedTiles(driver, 8)).toHaveLength(8);
  });

  test('works through the most recently explored ground first', async () => {
    // Where you have just been is what you want the app to name.
    await driver.run('INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (16, ?, ?, ?, ?)', [
      1,
      1,
      createTile(),
      NOW - 100_000,
    ]);
    await driver.run('INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (16, ?, ?, ?, ?)', [
      2,
      2,
      createTile(),
      NOW,
    ]);

    expect((await unresolvedTiles(driver, 1))[0]).toEqual({ x: 2, y: 2 });
  });
});

describe('recordPlace', () => {
  test('stores what a tile resolved to', async () => {
    await recordPlace(driver, { x: 5, y: 6 }, { country: '台灣', city: '新竹市' }, NOW);

    expect(await listPlaces(driver)).toEqual([{ country: '台灣', city: '新竹市' }]);
  });

  test('replaces an earlier answer rather than duplicating the tile', async () => {
    await recordPlace(driver, { x: 5, y: 6 }, { country: null, city: null }, NOW);
    await recordPlace(driver, { x: 5, y: 6 }, { country: '台灣', city: '新竹市' }, NOW + 1);

    expect(await listPlaces(driver)).toEqual([{ country: '台灣', city: '新竹市' }]);
  });
});

describe('countPlaces', () => {
  test('is zero before anything has been resolved', async () => {
    expect(await countPlaces(driver)).toEqual({ countries: 0, cities: 0 });
  });

  test('counts each country and city once, however many tiles are in it', async () => {
    await recordPlace(driver, { x: 1, y: 1 }, { country: '台灣', city: '新竹市' }, NOW);
    await recordPlace(driver, { x: 2, y: 1 }, { country: '台灣', city: '新竹市' }, NOW);
    await recordPlace(driver, { x: 3, y: 1 }, { country: '台灣', city: '台北市' }, NOW);

    expect(await countPlaces(driver)).toEqual({ countries: 1, cities: 2 });
  });

  test('counts several countries', async () => {
    await recordPlace(driver, { x: 1, y: 1 }, { country: '台灣', city: '新竹市' }, NOW);
    await recordPlace(driver, { x: 2, y: 1 }, { country: '日本', city: '京都市' }, NOW);

    expect(await countPlaces(driver)).toEqual({ countries: 2, cities: 2 });
  });

  test('does not count a tile that resolved to nothing', async () => {
    await recordPlace(driver, { x: 1, y: 1 }, { country: null, city: null }, NOW);

    expect(await countPlaces(driver)).toEqual({ countries: 0, cities: 0 });
  });

  test('counts a country even when its city is unknown', async () => {
    // Rural coordinates often resolve to a country and nothing finer. That is
    // still a country you have been to.
    await recordPlace(driver, { x: 1, y: 1 }, { country: '蒙古', city: null }, NOW);

    expect(await countPlaces(driver)).toEqual({ countries: 1, cities: 0 });
  });

  test('does not let the same city in two countries collapse into one', async () => {
    await recordPlace(driver, { x: 1, y: 1 }, { country: '美國', city: 'Springfield' }, NOW);
    await recordPlace(driver, { x: 2, y: 1 }, { country: '加拿大', city: 'Springfield' }, NOW);

    expect(await countPlaces(driver)).toEqual({ countries: 2, cities: 2 });
  });
});
