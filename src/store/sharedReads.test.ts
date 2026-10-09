import { beforeEach, describe, expect, test } from 'vitest';
import { buildMilestones } from './milestones';
import { migrate } from './schema';
import { totalDistanceMeters } from './stats';
import { buildSummary } from './summary';
import { countingDriver, type CountingDriver } from './testing/countingDriver';
import { createNodeDriver } from './testing/nodeDriver';

/**
 * The track is read in full to work out distance and the milestones, and the app
 * asks for those from several places at once on launch: the recorder for the
 * distance on the map, the stats screen for the whole summary. A cache of
 * finished answers does nothing for two callers who arrive together — neither
 * finds an answer yet, so both run the scan. These pin that they share one.
 */

const MORNING = Date.UTC(2026, 7, 2, 9, 0, 0);

let driver: CountingDriver;

beforeEach(async () => {
  driver = countingDriver(createNodeDriver(':memory:'));
  await migrate(driver);

  await driver.run('INSERT INTO segments (id, started_at) VALUES (1, ?)', [MORNING]);
  for (let i = 0; i < 5; i++) {
    await driver.run(
      'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (1, ?, ?, ?, 8)',
      [MORNING + i * 1000, 25.033, 121.5654 + i * 0.0005],
    );
  }
  driver.queries.length = 0;
});

const distanceScans = () =>
  driver.queries.filter((sql) => /SELECT segment_id, lat, lon\s+FROM points/.test(sql)).length;
const milestoneScans = () =>
  driver.queries.filter((sql) => /SELECT segment_id, ts, lat, lon\s+FROM points/.test(sql)).length;

describe('totalDistanceMeters', () => {
  test('is read once for callers that arrive together', async () => {
    const [a, b] = await Promise.all([totalDistanceMeters(driver), totalDistanceMeters(driver)]);

    expect(a).toBeGreaterThan(0);
    expect(b).toBe(a);
    expect(distanceScans()).toBe(1);
  });

  test('is read again once the track has moved on', async () => {
    await totalDistanceMeters(driver);
    await driver.run(
      'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (1, ?, ?, ?, 8)',
      [MORNING + 60_000, 25.033, 121.5754],
    );
    await totalDistanceMeters(driver);

    expect(distanceScans()).toBe(2);
  });

  test('does not remember a read that failed', async () => {
    const signature = await driver.get<{ count: number; last_ts: number }>(
      'SELECT count(*) AS count, max(ts) AS last_ts FROM points',
    );
    const sig = { count: signature!.count, lastTs: signature!.last_ts };

    driver.failNextRead(new Error('disk is busy'));
    await expect(totalDistanceMeters(driver, sig)).rejects.toThrow('disk is busy');

    await expect(totalDistanceMeters(driver, sig)).resolves.toBeGreaterThan(0);
  });
});

describe('buildMilestones', () => {
  test('is read once for callers that arrive together', async () => {
    const [a, b] = await Promise.all([buildMilestones(driver), buildMilestones(driver)]);

    expect(b).toEqual(a);
    expect(milestoneScans()).toBe(1);
  });

  test('does not remember a read that failed', async () => {
    const signature = await driver.get<{ count: number; last_ts: number }>(
      'SELECT count(*) AS count, max(ts) AS last_ts FROM points',
    );
    const sig = { count: signature!.count, lastTs: signature!.last_ts };

    driver.failNextRead(new Error('disk is busy'));
    await expect(buildMilestones(driver, sig)).rejects.toThrow('disk is busy');

    await expect(buildMilestones(driver, sig)).resolves.toMatchObject({ longestStreakDays: 1 });
  });
});

describe('buildSummary', () => {
  test('is built once for callers that arrive together', async () => {
    const [a, b] = await Promise.all([buildSummary(driver), buildSummary(driver)]);

    expect(b).toBe(a);
    expect(distanceScans()).toBe(1);
    expect(milestoneScans()).toBe(1);
  });

  test('shares the distance read with a recorder asking at the same moment', async () => {
    await Promise.all([buildSummary(driver), totalDistanceMeters(driver)]);

    expect(distanceScans()).toBe(1);
  });

  test('is built again when asked after the data changed', async () => {
    await buildSummary(driver);
    await driver.run(
      'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (1, ?, ?, ?, 8)',
      [MORNING + 90_000, 25.033, 121.5754],
    );
    const next = await buildSummary(driver);

    expect(next.distanceMeters).toBeGreaterThan(0);
    expect(distanceScans()).toBe(2);
  });
});
