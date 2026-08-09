import { beforeEach, describe, expect, test } from 'vitest';
import type { SqlDriver } from './driver';
import { migrate } from './schema';
import { totalDistanceMeters } from './stats';
import { createNodeDriver } from './testing/nodeDriver';

const ORIGIN = { lat: 25.033, lon: 121.5654 };

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
});

async function segment(id: number, startedAt: number) {
  await driver.run('INSERT INTO segments (id, started_at) VALUES (?, ?)', [id, startedAt]);
}

async function point(segmentId: number, ts: number, eastMeters: number) {
  await driver.run(
    'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
    [
      segmentId,
      ts,
      ORIGIN.lat,
      ORIGIN.lon + eastMeters / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
      8,
    ],
  );
}

describe('totalDistanceMeters', () => {
  test('is zero with no points at all', async () => {
    expect(await totalDistanceMeters(driver)).toBe(0);
  });

  test('is zero with a single point, which is not yet a journey', async () => {
    await segment(1, 0);
    await point(1, 0, 0);

    expect(await totalDistanceMeters(driver)).toBe(0);
  });

  test('sums the legs between consecutive points', async () => {
    await segment(1, 0);
    await point(1, 0, 0);
    await point(1, 1000, 100);
    await point(1, 2000, 250);

    expect(await totalDistanceMeters(driver)).toBeCloseTo(250, 0);
  });

  test('counts a there-and-back trip as the ground actually covered', async () => {
    await segment(1, 0);
    await point(1, 0, 0);
    await point(1, 1000, 100);
    await point(1, 2000, 0);

    expect(await totalDistanceMeters(driver)).toBeCloseTo(200, 0);
  });

  test('never joins across a segment boundary', async () => {
    // Two separate outings 300 km apart. The gap between them was a flight or
    // a switched-off phone, not a walk, and must not be counted.
    await segment(1, 0);
    await point(1, 0, 0);
    await point(1, 1000, 100);

    await segment(2, 999_000);
    await point(2, 999_000, 300_000);
    await point(2, 1_000_000, 300_050);

    expect(await totalDistanceMeters(driver)).toBeCloseTo(150, 0);
  });

  test('orders points by time, not by insertion', async () => {
    await segment(1, 0);
    await point(1, 2000, 250);
    await point(1, 0, 0);
    await point(1, 1000, 100);

    expect(await totalDistanceMeters(driver)).toBeCloseTo(250, 0);
  });
});
