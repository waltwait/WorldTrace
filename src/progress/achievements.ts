/**
 * Levels and achievements.
 *
 * Derived entirely from the summary and recomputed on every read — nothing is
 * stored except the moment a badge first unlocked. Changing a threshold here
 * can never leave someone holding a badge the rules no longer grant, or
 * missing one they have earned.
 */

import type { Summary } from '../store/summary';

/** How a value and its targets should be written out. */
export type Unit = 'distance' | 'area' | 'count';

export type TierLabel = '銅' | '銀' | '金';

const TIER_LABELS: TierLabel[] = ['銅', '銀', '金'];

export interface Tier {
  label: TierLabel;
  target: number;
  unlocked: boolean;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  unit: Unit;
  /** What the track currently measures for this achievement. */
  value: number;
  /** Always three, ordered bronze, silver, gold. */
  tiers: Tier[];
  /** How many tiers are earned, 0 to 3. */
  earned: number;
  /** How far from the last tier earned to the next one, 0 to 1. */
  progress: number;
  /** The next tier's target, or null once gold is earned. */
  nextTarget: number | null;
}

interface Goal {
  id: string;
  title: string;
  description: string;
  unit: Unit;
  /** Bronze, silver, gold. */
  targets: [number, number, number];
  measure: (summary: Summary) => number;
}

/**
 * Ten things worth doing, each worth doing three times over.
 *
 * Deliberately not all totals. Distance, area, days and tiles rise on their own
 * for anyone who simply leaves the app installed, so they only account for four
 * of the ten; the other six are personal bests — a streak, a hard day, one long
 * outing, distance from home, and being out at hours most people are not. Those
 * cannot be earned by waiting.
 *
 * Bronze is set where a first real outing lands, so nobody stares at an empty
 * board. Gold is set years out on purpose.
 */
const GOALS: Goal[] = [
  {
    id: 'walk',
    title: '路程',
    description: '累計走過的距離',
    unit: 'distance',
    targets: [1_000, 25_000, 250_000],
    measure: (summary) => summary.distanceMeters,
  },
  {
    id: 'area',
    title: '版圖',
    description: '擦開的迷霧面積',
    unit: 'area',
    targets: [50_000, 1_000_000, 10_000_000],
    measure: (summary) => summary.exploredSquareMeters,
  },
  {
    id: 'days',
    title: '足跡',
    description: '留下記錄的天數',
    unit: 'count',
    targets: [3, 15, 60],
    measure: (summary) => summary.dayCount,
  },
  {
    id: 'streak',
    title: '不間斷',
    description: '連續每天都有記錄',
    unit: 'count',
    targets: [2, 7, 30],
    measure: (summary) => summary.longestStreakDays,
  },
  {
    id: 'day-distance',
    title: '一日之力',
    description: '單日走過最遠的一次',
    unit: 'distance',
    targets: [3_000, 12_000, 42_195],
    measure: (summary) => summary.maxDayDistanceMeters,
  },
  {
    id: 'outing',
    title: '一口氣',
    description: '單次不中斷走過最遠的一次',
    unit: 'distance',
    targets: [1_000, 8_000, 25_000],
    measure: (summary) => summary.longestOutingMeters,
  },
  {
    id: 'radius',
    title: '遠行',
    description: '離最初起點最遠的距離',
    unit: 'distance',
    targets: [2_000, 25_000, 250_000],
    measure: (summary) => summary.farthestFromStartMeters,
  },
  {
    id: 'tiles',
    title: '踏過的方格',
    description: '到過的地圖磚格數',
    unit: 'count',
    targets: [5, 50, 500],
    measure: (summary) => summary.tileCount,
  },
  {
    id: 'night',
    title: '夜行',
    description: '在午夜到清晨五點之間出門的天數',
    unit: 'count',
    targets: [1, 5, 20],
    measure: (summary) => summary.nightDayCount,
  },
  {
    id: 'dawn',
    title: '早起',
    description: '在清晨五點到七點之間出門的天數',
    unit: 'count',
    targets: [1, 5, 20],
    measure: (summary) => summary.dawnDayCount,
  },
];

export function evaluateAchievements(summary: Summary): Achievement[] {
  return GOALS.map((goal) => {
    const value = goal.measure(summary);
    const tiers: Tier[] = goal.targets.map((target, index) => ({
      label: TIER_LABELS[index],
      target,
      unlocked: value >= target,
    }));

    const earned = tiers.filter((tier) => tier.unlocked).length;
    const nextTarget = earned < tiers.length ? tiers[earned].target : null;

    // Progress runs from the tier just earned to the next one, so the bar
    // refills each time rather than creeping across a single gold-sized span
    // where bronze and silver would both sit indistinguishably near zero.
    const floor = earned === 0 ? 0 : tiers[earned - 1].target;
    const progress =
      nextTarget === null ? 1 : Math.min(1, Math.max(0, (value - floor) / (nextTarget - floor)));

    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      unit: goal.unit,
      value,
      tiers,
      earned,
      progress,
      nextTarget,
    };
  });
}

/**
 * Area needed to reach each level, in square metres.
 *
 * Roughly geometric: early levels arrive within a walk or two, later ones take
 * genuine exploration. Level 1 is where everyone starts.
 */
const LEVEL_THRESHOLDS = [
  0, 1_000, 5_000, 20_000, 50_000, 150_000, 400_000, 1_000_000, 2_500_000, 6_000_000,
  15_000_000, 40_000_000, 100_000_000, 250_000_000,
];

export interface LevelProgress {
  level: number;
  /** How far into the current level, 0 to 1. */
  progress: number;
  /** Area at which the next level arrives, or null at the top. */
  nextLevelAtSquareMeters: number | null;
}

export function levelFor(summary: Summary): LevelProgress {
  const area = summary.exploredSquareMeters;

  let index = 0;
  while (index + 1 < LEVEL_THRESHOLDS.length && area >= LEVEL_THRESHOLDS[index + 1]) {
    index++;
  }

  const isTopLevel = index + 1 >= LEVEL_THRESHOLDS.length;
  if (isTopLevel) {
    return { level: index + 1, progress: 1, nextLevelAtSquareMeters: null };
  }

  const floor = LEVEL_THRESHOLDS[index];
  const ceiling = LEVEL_THRESHOLDS[index + 1];

  return {
    level: index + 1,
    progress: Math.min(1, Math.max(0, (area - floor) / (ceiling - floor))),
    nextLevelAtSquareMeters: ceiling,
  };
}
