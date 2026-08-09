import { describe, expect, test } from 'vitest';
import type { Summary } from '../store/summary';
import { evaluateAchievements, levelFor, type Achievement } from './achievements';

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    exploredCells: 0,
    exploredSquareMeters: 0,
    distanceMeters: 0,
    tileCount: 0,
    dayCount: 0,
    segmentCount: 0,
    firstRecordedAt: null,
    lastRecordedAt: null,
    longestStreakDays: 0,
    maxDayDistanceMeters: 0,
    longestOutingMeters: 0,
    farthestFromStartMeters: 0,
    nightDayCount: 0,
    dawnDayCount: 0,
    countries: 0,
    cities: 0,
    ...overrides,
  };
}

function find(list: Achievement[], id: string): Achievement {
  const found = list.find((a) => a.id === id);
  if (!found) throw new Error(`no achievement with id ${id}`);
  return found;
}

describe('evaluateAchievements', () => {
  test('gives every achievement a unique id', () => {
    const ids = evaluateAchievements(summary()).map((a) => a.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test('gives every achievement three tiers, bronze through gold', () => {
    for (const achievement of evaluateAchievements(summary())) {
      expect(achievement.tiers.map((tier) => tier.label)).toEqual(['銅', '銀', '金']);
    }
  });

  test('orders every set of tiers from easiest to hardest', () => {
    for (const achievement of evaluateAchievements(summary())) {
      const targets = achievement.tiers.map((tier) => tier.target);
      expect([...targets].sort((a, b) => a - b)).toEqual(targets);
    }
  });

  test('gives every achievement something to read', () => {
    for (const achievement of evaluateAchievements(summary())) {
      expect(achievement.title.length).toBeGreaterThan(0);
      expect(achievement.description.length).toBeGreaterThan(0);
    }
  });

  test('earns nothing before anything has been recorded', () => {
    const all = evaluateAchievements(summary());

    expect(all.every((a) => a.earned === 0)).toBe(true);
    expect(all.every((a) => a.tiers.every((tier) => !tier.unlocked))).toBe(true);
    expect(all.every((a) => a.progress === 0)).toBe(true);
  });

  test('earns bronze at exactly the bronze target', () => {
    const walk = find(evaluateAchievements(summary({ distanceMeters: 1_000 })), 'walk');

    expect(walk.earned).toBe(1);
    expect(walk.tiers[0].unlocked).toBe(true);
    expect(walk.tiers[1].unlocked).toBe(false);
  });

  test('earns every tier up to the value, not only the highest', () => {
    const walk = find(evaluateAchievements(summary({ distanceMeters: 250_000 })), 'walk');

    expect(walk.earned).toBe(3);
    expect(walk.tiers.every((tier) => tier.unlocked)).toBe(true);
  });

  test('measures progress from the tier just earned, so the bar restarts', () => {
    // Bronze is 1 km and silver 25 km. At 13 km the bar should read about half
    // of the way from bronze to silver — not a hair above zero, which is what
    // measuring from zero to gold would give.
    const walk = find(evaluateAchievements(summary({ distanceMeters: 13_000 })), 'walk');

    expect(walk.earned).toBe(1);
    expect(walk.nextTarget).toBe(25_000);
    expect(walk.progress).toBeCloseTo(0.5, 1);
  });

  test('measures the first tier from zero', () => {
    const walk = find(evaluateAchievements(summary({ distanceMeters: 500 })), 'walk');

    expect(walk.progress).toBeCloseTo(0.5, 5);
  });

  test('is complete with no next target once gold is earned', () => {
    const walk = find(evaluateAchievements(summary({ distanceMeters: 10_000_000 })), 'walk');

    expect(walk.progress).toBe(1);
    expect(walk.nextTarget).toBeNull();
  });

  test('reports the measured value, so a card can show where it stands', () => {
    const walk = find(evaluateAchievements(summary({ distanceMeters: 4_321 })), 'walk');

    expect(walk.value).toBe(4_321);
  });

  test('tells the UI how to render each value', () => {
    const all = evaluateAchievements(summary());

    expect(find(all, 'walk').unit).toBe('distance');
    expect(find(all, 'area').unit).toBe('area');
    expect(find(all, 'days').unit).toBe('count');
  });

  describe('the dimensions it measures', () => {
    test('rewards a run of consecutive days, not just a count of them', () => {
      const streak = find(evaluateAchievements(summary({ longestStreakDays: 2 })), 'streak');

      expect(streak.earned).toBeGreaterThan(0);
    });

    test('rewards one hard day, separately from the running total', () => {
      const all = evaluateAchievements(summary({ maxDayDistanceMeters: 3_000 }));

      expect(find(all, 'day-distance').earned).toBeGreaterThan(0);
      // One hard day is not a career total, and must not be counted as one.
      expect(find(all, 'walk').earned).toBe(0);
    });

    test('rewards one long unbroken outing', () => {
      const outing = find(evaluateAchievements(summary({ longestOutingMeters: 1_000 })), 'outing');

      expect(outing.earned).toBeGreaterThan(0);
    });

    test('rewards getting far from where you started', () => {
      const radius = find(
        evaluateAchievements(summary({ farthestFromStartMeters: 2_000 })),
        'radius',
      );

      expect(radius.earned).toBeGreaterThan(0);
    });

    test('rewards being out in the small hours, and being out at dawn', () => {
      const all = evaluateAchievements(summary({ nightDayCount: 1, dawnDayCount: 1 }));

      expect(find(all, 'night').earned).toBe(1);
      expect(find(all, 'dawn').earned).toBe(1);
    });

    test('rewards ground uncovered, tiles reached and days turned up', () => {
      const all = evaluateAchievements(
        summary({ exploredSquareMeters: 50_000, tileCount: 5, dayCount: 3 }),
      );

      expect(find(all, 'area').earned).toBe(1);
      expect(find(all, 'tiles').earned).toBe(1);
      expect(find(all, 'days').earned).toBe(1);
    });

    test('does not rest entirely on totals that only ever go up', () => {
      // Distance, area, days and tiles all climb on their own if you simply
      // keep the app installed long enough. At least half the achievements
      // have to need a personal best instead.
      const all = evaluateAchievements(summary());
      const cumulative = ['walk', 'area', 'days', 'tiles'];
      const byEffort = all.filter((a) => !cumulative.includes(a.id));

      expect(byEffort.length).toBeGreaterThanOrEqual(all.length / 2);
    });
  });

  test('is reachable on a first outing, and not finishable on one', () => {
    // Someone who has just walked a kilometre and a half should come away with
    // something. Nobody should come away with gold.
    const firstWalk = summary({
      distanceMeters: 1_430,
      exploredSquareMeters: 58_000,
      tileCount: 5,
      dayCount: 1,
      longestStreakDays: 1,
      maxDayDistanceMeters: 1_430,
      longestOutingMeters: 1_430,
      farthestFromStartMeters: 600,
    });
    const all = evaluateAchievements(firstWalk);

    expect(all.filter((a) => a.earned > 0).length).toBeGreaterThanOrEqual(3);
    expect(all.every((a) => a.earned < 3)).toBe(true);
  });
});

describe('levelFor', () => {
  test('starts at level 1', () => {
    expect(levelFor(summary()).level).toBe(1);
  });

  test('never goes backwards as more ground is explored', () => {
    let previous = 0;
    for (const area of [0, 1_000, 50_000, 1_000_000, 20_000_000, 500_000_000]) {
      const { level } = levelFor(summary({ exploredSquareMeters: area }));
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  test('reaches a higher level for a city-sized exploration', () => {
    expect(levelFor(summary({ exploredSquareMeters: 20_000_000 })).level).toBeGreaterThan(1);
  });

  test('reports progress towards the next level as a fraction', () => {
    const { progress } = levelFor(summary({ exploredSquareMeters: 500 }));

    expect(progress).toBeGreaterThanOrEqual(0);
    expect(progress).toBeLessThanOrEqual(1);
  });

  test('says how much more ground the next level needs', () => {
    const { nextLevelAtSquareMeters } = levelFor(summary({ exploredSquareMeters: 500 }));

    expect(nextLevelAtSquareMeters).toBeGreaterThan(500);
  });

  test('caps out rather than promising a level that does not exist', () => {
    const top = levelFor(summary({ exploredSquareMeters: Number.MAX_SAFE_INTEGER }));

    expect(top.progress).toBe(1);
    expect(top.nextLevelAtSquareMeters).toBeNull();
  });
});
