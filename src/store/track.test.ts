import { beforeEach, describe, expect, test } from 'vitest';
import type { SqlDriver } from './driver';
import { migrate } from './schema';
import { createNodeDriver } from './testing/nodeDriver';
import { listDays, loadOverviewTrack, loadTrack } from './track';

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

async function point(segmentId: number, ts: number, altitude: number | null = 10) {
  await driver.run(
    'INSERT INTO points (segment_id, ts, lat, lon, accuracy, altitude) VALUES (?, ?, ?, ?, ?, ?)',
    [segmentId, ts, 25.033, 121.5654, 8, altitude],
  );
}

describe('loadTrack', () => {
  test('is empty when nothing has been recorded', async () => {
    expect(await loadTrack(driver)).toEqual([]);
  });

  test('groups points under the segment they belong to', async () => {
    await segment(1, MORNING);
    await point(1, MORNING);
    await point(1, MORNING + 1000);
    await segment(2, MORNING + DAY);
    await point(2, MORNING + DAY);

    const track = await loadTrack(driver);

    expect(track).toHaveLength(2);
    expect(track[0].points).toHaveLength(2);
    expect(track[1].points).toHaveLength(1);
  });

  test('orders points within a segment by time', async () => {
    await segment(1, MORNING);
    await point(1, MORNING + 2000);
    await point(1, MORNING);
    await point(1, MORNING + 1000);

    const [only] = await loadTrack(driver);

    expect(only.points.map((p) => p.ts)).toEqual([MORNING, MORNING + 1000, MORNING + 2000]);
  });

  test('orders segments chronologically', async () => {
    await segment(2, MORNING + DAY);
    await point(2, MORNING + DAY);
    await segment(1, MORNING);
    await point(1, MORNING);

    const track = await loadTrack(driver);

    expect(track.map((s) => s.id)).toEqual([1, 2]);
  });

  test('leaves out segments that never got a point', async () => {
    await segment(1, MORNING);
    await segment(2, MORNING + DAY);
    await point(2, MORNING + DAY);

    expect((await loadTrack(driver)).map((s) => s.id)).toEqual([2]);
  });

  test('carries a missing altitude through as null', async () => {
    await segment(1, MORNING);
    await point(1, MORNING, null);

    const [only] = await loadTrack(driver);

    expect(only.points[0].altitude).toBeNull();
  });

  test('restricts the track to a time range when asked', async () => {
    await segment(1, MORNING);
    await point(1, MORNING);
    await segment(2, MORNING + DAY);
    await point(2, MORNING + DAY);

    const track = await loadTrack(driver, { from: MORNING + DAY - 1, to: MORNING + DAY + 1 });

    expect(track.map((s) => s.id)).toEqual([2]);
  });

  test('keeps only the in-range points of a segment that straddles the range', async () => {
    await segment(1, MORNING);
    await point(1, MORNING);
    await point(1, MORNING + 5000);
    await point(1, MORNING + 10_000);

    const [only] = await loadTrack(driver, { from: MORNING + 4000, to: MORNING + 6000 });

    expect(only.points.map((p) => p.ts)).toEqual([MORNING + 5000]);
  });
});

describe('listDays', () => {
  test('is empty when nothing has been recorded', async () => {
    expect(await listDays(driver)).toEqual([]);
  });

  test('reports one entry per day that has track', async () => {
    await segment(1, MORNING);
    await point(1, MORNING);
    await point(1, MORNING + 1000);
    await segment(2, MORNING + DAY);
    await point(2, MORNING + DAY);

    const days = await listDays(driver);

    expect(days).toHaveLength(2);
    expect(days[0].pointCount).toBe(1);
    expect(days[1].pointCount).toBe(2);
  });

  test('lists the most recent day first', async () => {
    await segment(1, MORNING);
    await point(1, MORNING);
    await segment(2, MORNING + DAY);
    await point(2, MORNING + DAY);

    const days = await listDays(driver);

    expect(days[0].date > days[1].date).toBe(true);
  });

  test('gives the bounds needed to load that day back', async () => {
    await segment(1, MORNING);
    await point(1, MORNING);
    await point(1, MORNING + 3_600_000);

    const [day] = await listDays(driver);

    expect(day.from).toBeLessThanOrEqual(MORNING);
    expect(day.to).toBeGreaterThanOrEqual(MORNING + 3_600_000);
  });
});

describe('loadOverviewTrack', () => {
  test('returns null when nothing has been recorded', async () => {
    expect(await loadOverviewTrack(driver)).toBeNull();
  });

  test('ignores segments with only one point', async () => {
    await segment(1, MORNING);
    await point(1, MORNING);

    expect(await loadOverviewTrack(driver)).toBeNull();
  });

  test('assembles multiple segments into a MultiLineString feature', async () => {
    await segment(1, MORNING);
    await driver.run(
      'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
      [1, MORNING, 25.0, 121.5, 5],
    );
    await driver.run(
      'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
      [1, MORNING + 1000, 25.001, 121.501, 5],
    );

    await segment(2, MORNING + DAY);
    await driver.run(
      'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
      [2, MORNING + DAY, 25.1, 121.6, 5],
    );
    await driver.run(
      'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
      [2, MORNING + DAY + 1000, 25.102, 121.602, 5],
    );

    const feature = await loadOverviewTrack(driver);
    expect(feature).not.toBeNull();
    expect(feature?.geometry.type).toBe('MultiLineString');
    expect(feature?.geometry.coordinates).toHaveLength(2);
    expect(feature?.geometry.coordinates[0]).toEqual([
      [121.5, 25.0],
      [121.501, 25.001],
    ]);
    expect(feature?.geometry.coordinates[1]).toEqual([
      [121.6, 25.1],
      [121.602, 25.102],
    ]);
  });

  test('downsamples points closer than 10 meters while retaining segment endpoints', async () => {
    await segment(1, MORNING);
    // 0.00001 deg lat is ~1.1 meters
    for (let i = 0; i <= 20; i++) {
      await driver.run(
        'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
        [1, MORNING + i * 1000, 25.0 + i * 0.00001, 121.5, 5],
      );
    }

    const feature = await loadOverviewTrack(driver);
    expect(feature).not.toBeNull();
    const line = feature!.geometry.coordinates[0];
    // 21 points spaced by 1.1m (total ~22m) should be downsampled to ~3 points (start, ~10m, and end)
    expect(line.length).toBeLessThan(6);
    expect(line.length).toBeGreaterThanOrEqual(2);
    // Exact start and end are preserved
    expect(line[0]).toEqual([121.5, 25.0]);
    expect(line[line.length - 1]).toEqual([121.5, 25.0002]);
  });
});
