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

/**
 * Naming a tile costs a network call and only twelve are made a launch, so the
 * order matters more than the speed. Counting where you have been means finding
 * the places nothing has been named near yet before naming more of the places
 * that already have been — a tile in a new country says more than the
 * thousandth tile of a city already known.
 *
 * It was ordered by when a tile was last touched instead. Rebuilds and
 * redrawing refresh that for whole swathes of old ground at once, so a three-day
 * trip abroad sat behind six hundred tiles at home: fifty launches before the
 * first foreign tile was named, and no country but the one you live in.
 */
describe('unresolvedTiles in new places first', () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function tileAt(x: number, y: number, updatedAt: number) {
    await driver.run('INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (16, ?, ?, ?, ?)', [
      x,
      y,
      createTile(),
      updatedAt,
    ]);
  }

  async function named(x: number, y: number, country: string | null = '台灣') {
    await recordPlace(driver, { x, y }, { country, city: null }, NOW);
  }

  // Roughly Hsinchu, and roughly Singapore, which are thousands of tiles apart.
  const HOME = { x: 54700, y: 28000 };
  const ABROAD = { x: 51700, y: 32500 };

  test('offers ground far from anything named before newer ground beside it', async () => {
    await tileAt(HOME.x, HOME.y, NOW);
    await named(HOME.x, HOME.y);
    for (let i = 1; i <= 30; i++) await tileAt(HOME.x + i, HOME.y, NOW);
    await tileAt(ABROAD.x, ABROAD.y, NOW - 10 * DAY);

    const offered = await unresolvedTiles(driver, 12);

    expect(offered[0]).toEqual(ABROAD);
  });

  test('takes one tile from each area nothing has been named in, before a second from any', async () => {
    await named(HOME.x, HOME.y);
    await tileAt(ABROAD.x, ABROAD.y, NOW - 5 * DAY);
    await tileAt(ABROAD.x + 1, ABROAD.y, NOW - 6 * DAY);
    await tileAt(10000, 10000, NOW - 20 * DAY);

    const offered = await unresolvedTiles(driver, 2);

    expect(offered).toEqual([ABROAD, { x: 10000, y: 10000 }]);
  });

  test('prefers the newest tile of an unnamed area', async () => {
    await named(HOME.x, HOME.y);
    await tileAt(ABROAD.x, ABROAD.y, NOW - 9 * DAY);
    await tileAt(ABROAD.x + 3, ABROAD.y + 2, NOW - 1 * DAY);

    expect((await unresolvedTiles(driver, 1))[0]).toEqual({ x: ABROAD.x + 3, y: ABROAD.y + 2 });
  });

  test('prefers a stretch of a city nothing has been named in over newer ground beside a named tile', async () => {
    // All inside one 64-tile block, so only the finer rule can tell them apart.
    await named(1, 1);
    await tileAt(2, 2, NOW);
    await tileAt(3, 2, NOW);
    await tileAt(40, 40, NOW - 30 * DAY);

    expect((await unresolvedTiles(driver, 1))[0]).toEqual({ x: 40, y: 40 });
  });

  test('counts ground that resolved to nothing as named, so the open sea is not retried', async () => {
    await named(ABROAD.x, ABROAD.y, null);
    await tileAt(ABROAD.x + 1, ABROAD.y, NOW);
    await tileAt(HOME.x, HOME.y, NOW - 40 * DAY);
    await named(HOME.x + 2, HOME.y);

    // Both are beside something named; neither is "new ground", so newest first.
    expect((await unresolvedTiles(driver, 1))[0]).toEqual({ x: ABROAD.x + 1, y: ABROAD.y });
  });

  test('does not mistake ground next door for new ground because a grid line runs between', async () => {
    // 54719 and 54720 sit either side of a 64-tile boundary, a tile apart. Only
    // distance says whether ground is new, not which cell of a grid it is in.
    await named(54719, HOME.y);
    for (let i = 0; i < 20; i++) await tileAt(54720 + i, HOME.y, NOW);
    await tileAt(ABROAD.x, ABROAD.y, NOW - 20 * DAY);

    expect((await unresolvedTiles(driver, 1))[0]).toEqual(ABROAD);
  });

  test('counts ground in the next cell over as new once it is far enough away', async () => {
    // 100 tiles is in the neighbouring cell of the lookup grid but well past the
    // 64-tile reach: the grid finds candidates, the distance decides.
    await named(1000, 1000);
    for (let i = 1; i <= 20; i++) await tileAt(1000 + i, 1000, NOW);
    await tileAt(1100, 1000, NOW - 30 * DAY);

    expect((await unresolvedTiles(driver, 1))[0]).toEqual({ x: 1100, y: 1000 });
  });

  test('puts the edge of the reach exactly: 63 tiles away is near, 64 is new', async () => {
    await named(1000, 1000);
    await tileAt(1063, 1000, NOW);
    await tileAt(1064, 1000, NOW - 30 * DAY);

    // 1063 is within 64 of the named tile, 1064 is not.
    expect((await unresolvedTiles(driver, 1))[0]).toEqual({ x: 1064, y: 1000 });
  });

  test('falls back to the newest first once every area has an answer', async () => {
    await named(1, 1);
    await tileAt(2, 1, NOW - 2 * DAY);
    await tileAt(1, 2, NOW);
    await tileAt(2, 2, NOW - 1 * DAY);

    expect(await unresolvedTiles(driver, 3)).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ]);
  });

  test('offers every unresolved tile exactly once when asked for all of them', async () => {
    await named(HOME.x, HOME.y);
    for (let i = 0; i < 20; i++) await tileAt(HOME.x + i + 1, HOME.y, NOW - i * 1000);
    for (let i = 0; i < 20; i++) await tileAt(ABROAD.x + i, ABROAD.y + (i % 3), NOW - i * 1000);

    const offered = await unresolvedTiles(driver, 1000);
    const keys = offered.map((t) => `${t.x},${t.y}`);

    expect(offered).toHaveLength(40);
    expect(new Set(keys).size).toBe(40);
  });

  test('puts the new country in the first pass however many tiles are waiting', async () => {
    await named(HOME.x, HOME.y);
    for (let i = 0; i < 600; i++) {
      await tileAt(HOME.x + 1 + (i % 50), HOME.y + Math.floor(i / 50), NOW);
    }
    await tileAt(ABROAD.x, ABROAD.y, NOW - 14 * DAY);

    const firstPass = await unresolvedTiles(driver, 12);

    expect(firstPass).toContainEqual(ABROAD);
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
