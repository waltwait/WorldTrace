import { beforeEach, describe, expect, test } from 'vitest';
import { createTile, getBit, popcount, setBit } from '../fog/bitmap';
import { locationToBit } from '../fog/tiles';
import type { SqlDriver } from './driver';
import { rebuildFog } from './rebuild';
import { migrate } from './schema';
import { createNodeDriver } from './testing/nodeDriver';

const BASE = Date.UTC(2026, 7, 2, 9, 0, 0);
const ORIGIN = { lat: 25.033, lon: 121.5654 };

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
});

/** A point `eastMeters` east of the origin, `seconds` after the start. */
function at(eastMeters: number) {
  return {
    lat: ORIGIN.lat,
    lon: ORIGIN.lon + eastMeters / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  };
}

async function segment(id: number) {
  await driver.run('INSERT INTO segments (id, started_at) VALUES (?, ?)', [id, BASE]);
}

async function point(segmentId: number, seconds: number, eastMeters: number) {
  const p = at(eastMeters);
  await driver.run(
    'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
    [segmentId, BASE + seconds * 1000, p.lat, p.lon, 8],
  );
}

async function fogClearedAt(place: { lat: number; lon: number }): Promise<boolean> {
  const bit = locationToBit(place.lat, place.lon);
  const row = await driver.get<{ bitmap: Uint8Array }>(
    'SELECT bitmap FROM fog_tiles WHERE z = 16 AND x = ? AND y = ?',
    [bit.x, bit.y],
  );
  return row ? getBit(row.bitmap, bit.bx, bit.by) : false;
}

async function totalCells(): Promise<number> {
  const tiles = await driver.all<{ bitmap: Uint8Array }>('SELECT bitmap FROM fog_tiles');
  return tiles.reduce((sum, t) => sum + popcount(t.bitmap), 0);
}

describe('rebuildFog', () => {
  test('does nothing to an empty database', async () => {
    const result = await rebuildFog(driver);

    expect(result).toEqual({ pointsRead: 0, cellsAdded: 0, tilesTouched: 0 });
  });

  test('paints the corridor between two fixes', async () => {
    await segment(1);
    await point(1, 0, 0);
    await point(1, 60, 200);

    await rebuildFog(driver);

    expect(await fogClearedAt(at(100))).toBe(true);
  });

  test('fills a gap the old limits refused', async () => {
    // The real case: 1,445 m in 361 s on a bicycle. Under the old 500 m rule
    // this was left as a hole; the points were kept, so it can be filled in.
    await segment(1);
    await point(1, 0, 0);
    await point(1, 361, 1445);

    await rebuildFog(driver);

    expect(await fogClearedAt(at(700))).toBe(true);
  });

  test('reports what it did', async () => {
    await segment(1);
    await point(1, 0, 0);
    await point(1, 60, 200);

    const result = await rebuildFog(driver);

    expect(result.pointsRead).toBe(2);
    expect(result.cellsAdded).toBeGreaterThan(0);
    expect(result.tilesTouched).toBeGreaterThan(0);
  });

  test('never removes fog that is already there', async () => {
    // Fog outlives the track: a snapshot may have been restored, or old points
    // trimmed. Rebuilding must only ever add, or it would quietly delete
    // ground somebody really covered.
    const bitmap = createTile();
    setBit(bitmap, 5, 5);
    await driver.run(
      'INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (16, ?, ?, ?, ?)',
      [999, 999, bitmap, BASE],
    );

    await rebuildFog(driver);

    const row = await driver.get<{ bitmap: Uint8Array }>(
      'SELECT bitmap FROM fog_tiles WHERE x = 999 AND y = 999',
    );
    expect(getBit(row!.bitmap, 5, 5)).toBe(true);
  });

  test('adds to a tile that already holds fog rather than replacing it', async () => {
    await segment(1);
    await point(1, 0, 0);
    await point(1, 60, 200);
    await rebuildFog(driver);

    const before = await totalCells();

    // A second outing further along the same road, in the same tile.
    await point(1, 120, 400);
    await rebuildFog(driver);

    expect(await totalCells()).toBeGreaterThan(before);
    expect(await fogClearedAt(at(100))).toBe(true);
  });

  test('is idempotent — running it twice changes nothing the second time', async () => {
    await segment(1);
    await point(1, 0, 0);
    await point(1, 60, 200);

    await rebuildFog(driver);
    const after = await totalCells();
    const second = await rebuildFog(driver);

    expect(await totalCells()).toBe(after);
    expect(second.cellsAdded).toBe(0);
  });

  test('does not join across a segment boundary', async () => {
    await segment(1);
    await segment(2);
    await point(1, 0, 0);
    await point(2, 60, 400);

    await rebuildFog(driver);

    expect(await fogClearedAt(at(200))).toBe(false);
    expect(await fogClearedAt(at(400))).toBe(true);
  });

  test('leaves a hole where the silence was too long to guess across', async () => {
    await segment(1);
    await point(1, 0, 0);
    await point(1, 60 * 60, 400);

    await rebuildFog(driver);

    expect(await fogClearedAt(at(200))).toBe(false);
    expect(await fogClearedAt(ORIGIN)).toBe(true);
  });

  test('still marks a lone fix, with no neighbour to join to', async () => {
    await segment(1);
    await point(1, 0, 0);

    await rebuildFog(driver);

    expect(await fogClearedAt(ORIGIN)).toBe(true);
  });

  test('reads points in time order, not insertion order', async () => {
    // Batched delivery can store fixes out of order. Painting them in the
    // order they happen to sit in the table would draw the route backwards
    // and forwards across itself.
    await segment(1);
    await point(1, 120, 400);
    await point(1, 0, 0);
    await point(1, 60, 200);

    const result = await rebuildFog(driver);

    expect(result.pointsRead).toBe(3);
    expect(await fogClearedAt(at(100))).toBe(true);
    expect(await fogClearedAt(at(300))).toBe(true);
  });
});
