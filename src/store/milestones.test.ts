import { beforeEach, describe, expect, test } from 'vitest';
import type { SqlDriver } from './driver';
import { buildMilestones } from './milestones';
import { migrate } from './schema';
import { createNodeDriver } from './testing/nodeDriver';

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
});

/**
 * Built from local-time parts on purpose.
 *
 * The night and dawn windows are read back out of SQLite with 'localtime', so a
 * timestamp built in UTC would land in a different hour on every machine.
 */
function at(day: number, hour: number, minute = 0): number {
  return new Date(2026, 7, day, hour, minute, 0).getTime();
}

async function segment(id: number, startedAt: number) {
  await driver.run('INSERT INTO segments (id, started_at) VALUES (?, ?)', [id, startedAt]);
}

/** One fix, placed `eastMeters` east of a fixed point in Taipei. */
async function point(segmentId: number, ts: number, eastMeters = 0) {
  await driver.run(
    'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
    [segmentId, ts, 25.033, 121.5654 + eastMeters / 100_900, 8],
  );
}

describe('buildMilestones', () => {
  test('is all zeroes before anything has been recorded', async () => {
    expect(await buildMilestones(driver)).toEqual({
      longestStreakDays: 0,
      maxDayDistanceMeters: 0,
      longestOutingMeters: 0,
      farthestFromStartMeters: 0,
      nightDayCount: 0,
      dawnDayCount: 0,
    });
  });

  describe('longestStreakDays', () => {
    test('counts a run of consecutive days', async () => {
      await segment(1, at(2, 10));
      await point(1, at(2, 10));
      await point(1, at(3, 10));
      await point(1, at(4, 10));

      expect((await buildMilestones(driver)).longestStreakDays).toBe(3);
    });

    test('a single day is a streak of one', async () => {
      await segment(1, at(2, 10));
      await point(1, at(2, 10));

      expect((await buildMilestones(driver)).longestStreakDays).toBe(1);
    });

    test('a missed day breaks the run', async () => {
      await segment(1, at(2, 10));
      await point(1, at(2, 10));
      await point(1, at(3, 10));
      // Nothing on the 4th.
      await point(1, at(5, 10));

      expect((await buildMilestones(driver)).longestStreakDays).toBe(2);
    });

    test('reports the longest run, not the most recent one', async () => {
      await segment(1, at(2, 10));
      for (const day of [2, 3, 4, 5]) await point(1, at(day, 10));
      await point(1, at(10, 10));

      expect((await buildMilestones(driver)).longestStreakDays).toBe(4);
    });

    test('several fixes in one day still only count as one day', async () => {
      await segment(1, at(2, 8));
      await point(1, at(2, 8));
      await point(1, at(2, 12));
      await point(1, at(2, 20));

      expect((await buildMilestones(driver)).longestStreakDays).toBe(1);
    });
  });

  describe('maxDayDistanceMeters', () => {
    test('reports the busiest single day, not the total', async () => {
      await segment(1, at(2, 10));
      await point(1, at(2, 10), 0);
      await point(1, at(2, 11), 300);

      await segment(2, at(3, 10));
      await point(2, at(3, 10), 0);
      await point(2, at(3, 11), 1000);

      const { maxDayDistanceMeters } = await buildMilestones(driver);

      expect(maxDayDistanceMeters).toBeGreaterThan(950);
      expect(maxDayDistanceMeters).toBeLessThan(1050);
    });

    test('adds up every leg within the day', async () => {
      await segment(1, at(2, 10));
      await point(1, at(2, 10), 0);
      await point(1, at(2, 11), 400);
      await point(1, at(2, 12), 800);

      const { maxDayDistanceMeters } = await buildMilestones(driver);

      expect(maxDayDistanceMeters).toBeGreaterThan(750);
      expect(maxDayDistanceMeters).toBeLessThan(850);
    });

    test('does not join a leg across midnight into either day', async () => {
      // The gap between two days is a phone that was asleep, not a walk.
      await segment(1, at(2, 23, 50));
      await point(1, at(2, 23, 50), 0);
      await point(1, at(3, 0, 10), 5000);

      expect((await buildMilestones(driver)).maxDayDistanceMeters).toBe(0);
    });
  });

  describe('longestOutingMeters', () => {
    test('reports the longest single segment', async () => {
      await segment(1, at(2, 10));
      await point(1, at(2, 10), 0);
      await point(1, at(2, 11), 500);

      await segment(2, at(2, 14));
      await point(2, at(2, 14), 0);
      await point(2, at(2, 15), 2000);

      const { longestOutingMeters } = await buildMilestones(driver);

      expect(longestOutingMeters).toBeGreaterThan(1900);
      expect(longestOutingMeters).toBeLessThan(2100);
    });

    test('never joins two segments into one outing', async () => {
      // Two 500 m outings are not a single 1 km one, however close in time.
      await segment(1, at(2, 10));
      await point(1, at(2, 10), 0);
      await point(1, at(2, 11), 500);

      await segment(2, at(2, 12));
      await point(2, at(2, 12), 500);
      await point(2, at(2, 13), 1000);

      expect((await buildMilestones(driver)).longestOutingMeters).toBeLessThan(600);
    });
  });

  describe('farthestFromStartMeters', () => {
    test('measures displacement from the first fix ever recorded', async () => {
      await segment(1, at(2, 10));
      await point(1, at(2, 10), 0);
      await point(1, at(2, 11), 3000);

      const { farthestFromStartMeters } = await buildMilestones(driver);

      expect(farthestFromStartMeters).toBeGreaterThan(2900);
      expect(farthestFromStartMeters).toBeLessThan(3100);
    });

    test('is displacement, not path length — walking back does not add to it', async () => {
      await segment(1, at(2, 10));
      await point(1, at(2, 10), 0);
      await point(1, at(2, 11), 1000);
      await point(1, at(2, 12), 0);

      const { farthestFromStartMeters } = await buildMilestones(driver);

      expect(farthestFromStartMeters).toBeGreaterThan(950);
      expect(farthestFromStartMeters).toBeLessThan(1050);
    });

    test('spans segments, unlike distance', async () => {
      // Displacement from home is a fact about where you got to. It does not
      // matter that the phone restarted on the way.
      await segment(1, at(2, 10));
      await point(1, at(2, 10), 0);

      await segment(2, at(9, 10));
      await point(2, at(9, 10), 8000);

      expect((await buildMilestones(driver)).farthestFromStartMeters).toBeGreaterThan(7000);
    });
  });

  describe('nightDayCount and dawnDayCount', () => {
    test('counts a day with a fix in the small hours as a night', async () => {
      await segment(1, at(2, 2));
      await point(1, at(2, 2));

      expect((await buildMilestones(driver)).nightDayCount).toBe(1);
    });

    test('counts a day with a fix just after five as a dawn', async () => {
      await segment(1, at(2, 5, 30));
      await point(1, at(2, 5, 30));

      const milestones = await buildMilestones(driver);

      expect(milestones.dawnDayCount).toBe(1);
      expect(milestones.nightDayCount).toBe(0);
    });

    test('an ordinary daytime walk is neither', async () => {
      await segment(1, at(2, 14));
      await point(1, at(2, 14));

      const milestones = await buildMilestones(driver);

      expect(milestones.nightDayCount).toBe(0);
      expect(milestones.dawnDayCount).toBe(0);
    });

    test('counts days, not fixes', async () => {
      await segment(1, at(2, 1));
      await point(1, at(2, 1));
      await point(1, at(2, 3));
      await point(1, at(2, 4));

      expect((await buildMilestones(driver)).nightDayCount).toBe(1);
    });

    test('a single day can be both, if you were out that long', async () => {
      await segment(1, at(2, 3));
      await point(1, at(2, 3));
      await point(1, at(2, 6));

      const milestones = await buildMilestones(driver);

      expect(milestones.nightDayCount).toBe(1);
      expect(milestones.dawnDayCount).toBe(1);
    });
  });
});
