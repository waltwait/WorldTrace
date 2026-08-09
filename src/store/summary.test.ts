import { beforeEach, describe, expect, test } from 'vitest';
import { createTile, setBit } from '../fog/bitmap';
import { locationToBit } from '../fog/tiles';
import type { SqlDriver } from './driver';
import { migrate } from './schema';
import { buildSummary } from './summary';
import { createNodeDriver } from './testing/nodeDriver';

const DAY = 24 * 60 * 60 * 1000;
const MORNING = Date.UTC(2026, 7, 2, 9, 0, 0);

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
});

async function segment(id: number, startedAt: number) {
  await driver.run('INSERT INTO segments (id, started_at) VALUES (?, ?)', [id, startedAt]);
}

async function point(segmentId: number, ts: number, eastMeters = 0) {
  await driver.run(
    'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
    [segmentId, ts, 25.033, 121.5654 + eastMeters / 100_000, 8],
  );
}

async function tile(x: number, y: number, cells: number) {
  const bitmap = createTile();
  for (let i = 0; i < cells; i++) setBit(bitmap, i % 128, Math.floor(i / 128));
  await driver.run(
    'INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (16, ?, ?, ?, ?)',
    [x, y, bitmap, MORNING],
  );
}

describe('buildSummary', () => {
  test('is all zeroes before anything has been recorded', async () => {
    const summary = await buildSummary(driver);

    expect(summary).toMatchObject({
      exploredCells: 0,
      exploredSquareMeters: 0,
      distanceMeters: 0,
      tileCount: 0,
      dayCount: 0,
      segmentCount: 0,
      firstRecordedAt: null,
      lastRecordedAt: null,
    });
  });

  test('counts explored cells across every tile', async () => {
    await tile(1, 1, 100);
    await tile(2, 1, 50);

    const summary = await buildSummary(driver);

    expect(summary.exploredCells).toBe(150);
    expect(summary.tileCount).toBe(2);
  });

  test('converts explored cells into ground area', async () => {
    // The tile has to sit where the walking happened: cell size shrinks with
    // latitude, so a tile near the pole covers almost no ground at all.
    const taipei = locationToBit(25.033, 121.5654);
    await segment(1, MORNING);
    await point(1, MORNING);
    await tile(taipei.x, taipei.y, 100);

    const summary = await buildSummary(driver);

    // One cell is roughly 4.3 m across at this latitude, so ~18.5 m² each.
    expect(summary.exploredSquareMeters).toBeGreaterThan(100 * 15);
    expect(summary.exploredSquareMeters).toBeLessThan(100 * 25);
  });

  test('reports how many separate days have track', async () => {
    await segment(1, MORNING);
    await point(1, MORNING);
    await point(1, MORNING + 1000);
    await segment(2, MORNING + DAY);
    await point(2, MORNING + DAY);

    expect((await buildSummary(driver)).dayCount).toBe(2);
  });

  test('reports how many outings there were', async () => {
    await segment(1, MORNING);
    await point(1, MORNING);
    await segment(2, MORNING + DAY);
    await point(2, MORNING + DAY);

    expect((await buildSummary(driver)).segmentCount).toBe(2);
  });

  test('reports the span of the whole record', async () => {
    await segment(1, MORNING);
    await point(1, MORNING);
    await point(1, MORNING + DAY * 3);

    const summary = await buildSummary(driver);

    expect(summary.firstRecordedAt).toBe(MORNING);
    expect(summary.lastRecordedAt).toBe(MORNING + DAY * 3);
  });

  test('sums the distance walked', async () => {
    await segment(1, MORNING);
    await point(1, MORNING, 0);
    await point(1, MORNING + 1000, 100);

    expect((await buildSummary(driver)).distanceMeters).toBeGreaterThan(0);
  });

  test('does not count an outing that produced no points', async () => {
    await segment(1, MORNING);

    expect((await buildSummary(driver)).segmentCount).toBe(0);
  });
});
