import { beforeEach, describe, expect, test } from 'vitest';
import type { SqlDriver } from './driver';
import { migrate } from './schema';
import { totalDistanceMeters } from './stats';
import { countingDriver, type CountingDriver } from './testing/countingDriver';
import { createNodeDriver } from './testing/nodeDriver';

/**
 * Distance used to be read from the whole track every time a point arrived,
 * which on a walk is every poll. These pin that a new point costs a new point,
 * and — the part that matters more — that the cheap answer is never different
 * from the full one.
 */

let inner: SqlDriver;
let driver: CountingDriver;

beforeEach(async () => {
  inner = createNodeDriver(':memory:');
  await migrate(inner);
  driver = countingDriver(inner);
});

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

async function segment(id: number) {
  await inner.run('INSERT INTO segments (id, started_at) VALUES (?, 0)', [id]);
}

async function point(segmentId: number, ts: number, lat: number, lon: number, id?: number) {
  if (id === undefined) {
    await inner.run(
      'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, 8)',
      [segmentId, ts, lat, lon],
    );
  } else {
    await inner.run(
      'INSERT INTO points (id, segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?, 8)',
      [id, segmentId, ts, lat, lon],
    );
  }
}

/** The answer with nothing remembered: a driver object nobody has asked yet. */
const fresh = () => totalDistanceMeters(countingDriver(inner));

const isFullScan = (sql: string) =>
  /FROM points\s+ORDER BY/.test(sql) && !/WHERE/.test(sql);

describe('totalDistanceMeters, as the track grows', () => {
  test('stays equal to the full answer across batches, segments and a restart of a segment', async () => {
    const next = random(11);
    let ts = 1_000;
    let lat = 25.03;
    let lon = 121.56;
    let nextSegment = 1;

    for (let batch = 0; batch < 12; batch++) {
      if (batch % 3 === 0) {
        await segment(nextSegment);
        lat += 0.5 * next();
        lon += 0.5 * next();
        nextSegment++;
      }
      for (let i = 0; i < 1 + Math.floor(next() * 6); i++) {
        ts += 1_000 + Math.floor(next() * 4_000);
        lat += (next() - 0.5) * 0.0004;
        lon += (next() - 0.5) * 0.0004;
        await point(nextSegment - 1, ts, lat, lon);
      }
      expect(await totalDistanceMeters(driver)).toBeCloseTo(await fresh(), 6);
    }
  });

  test('reads only the new points, not the track again', async () => {
    await segment(1);
    for (let i = 0; i < 200; i++) await point(1, i * 1000, 25.03, 121.56 + i * 0.0001);
    await totalDistanceMeters(driver);

    const before = driver.rowsRead;
    const queriesBefore = driver.queries.length;
    for (let i = 200; i < 203; i++) await point(1, i * 1000, 25.03, 121.56 + i * 0.0001);
    const total = await totalDistanceMeters(driver);

    expect(total).toBeCloseTo(await fresh(), 6);
    expect(driver.rowsRead - before).toBeLessThan(10);
    expect(driver.queries.slice(queriesBefore).some(isFullScan)).toBe(false);
  });

  test('joins a new point to the end of its own segment, and to no other', async () => {
    await segment(1);
    await segment(2);
    await point(1, 1000, 25.03, 121.56);
    await point(1, 2000, 25.03, 121.561);
    await point(2, 3000, 24.0, 120.0);
    await totalDistanceMeters(driver);

    // Back in segment 1 after segment 2 began: the leg runs from segment 1's
    // own last point, not from segment 2's.
    await point(1, 4000, 25.03, 121.562);

    expect(await totalDistanceMeters(driver)).toBeCloseTo(await fresh(), 6);
  });

  test('is still right when nothing was added', async () => {
    await segment(1);
    await point(1, 1000, 25.03, 121.56);
    await point(1, 2000, 25.03, 121.561);
    const first = await totalDistanceMeters(driver);

    expect(await totalDistanceMeters(driver)).toBe(first);
  });
});

describe('totalDistanceMeters, when the cheap answer cannot be trusted', () => {
  async function walked(count: number) {
    await segment(1);
    for (let i = 0; i < count; i++) await point(1, (i + 1) * 1000, 25.03, 121.56 + i * 0.0001);
  }

  test('starts over when points have gone', async () => {
    await walked(20);
    await totalDistanceMeters(driver);

    await inner.run('DELETE FROM points WHERE id <= 10');

    expect(await totalDistanceMeters(driver)).toBeCloseTo(await fresh(), 6);
  });

  test('starts over when a point appears behind the last one it saw', async () => {
    await walked(20);
    await inner.run('DELETE FROM points WHERE id = 1');
    await totalDistanceMeters(driver);

    // Same count as before the delete, a later newest time, but the new row sits
    // under the id it already read up to, so reading "after that id" finds nothing.
    await point(1, 99_000, 25.03, 121.7, 1);

    expect(await totalDistanceMeters(driver)).toBeCloseTo(await fresh(), 6);
  });

  test('starts over when a point arrives out of time order within its segment', async () => {
    await walked(10);
    await totalDistanceMeters(driver);

    await point(1, 5_500, 25.04, 121.6);

    expect(await totalDistanceMeters(driver)).toBeCloseTo(await fresh(), 6);
  });

  test('does not keep a half-read answer after a failure', async () => {
    await walked(10);
    await totalDistanceMeters(driver);
    await point(1, 50_000, 25.03, 121.57);

    driver.failNextRead(new Error('disk is busy'));
    await expect(totalDistanceMeters(driver)).rejects.toThrow('disk is busy');

    expect(await totalDistanceMeters(driver)).toBeCloseTo(await fresh(), 6);
  });
});
