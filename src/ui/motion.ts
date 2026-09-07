/**
 * The app's shared motion vocabulary.
 *
 * Kept together for the same reason theme.ts keeps colour together: four
 * screens animating on four sets of numbers reads as four apps. Durations are
 * short on purpose — this is feedback, not decoration.
 *
 * Everything here is pure so the awkward parts can be tested. The awkward part
 * is barTransform: the honest way to fill a progress bar is to animate its
 * width, and width is a layout property, so every frame would recalculate
 * layout on the JS thread. This app has already been slow once. Bars scale
 * instead, which the native driver can run on its own thread.
 */

/** Milliseconds. */
export const DURATION = {
  /** Cards, rows, banners arriving. */
  enter: 220,
  /** A whole page sliding past. Distance earns the extra time. */
  page: 280,
  /** A bar filling: slow enough to read as filling rather than jumping. */
  bar: 420,
  /** Digits counting up. */
  count: 520,
} as const;

/** Cubic-bezier control points, for Easing.bezier. */
export const CURVE = {
  /** Entrances. Decisive start, long settle. */
  enter: [0.22, 1, 0.36, 1],
  /** Things travelling across the screen. */
  move: [0.25, 1, 0.5, 1],
} as const;

/**
 * How far the page being left behind dims during a slide. Enough to read as
 * receding, not so much that half the screen goes dark mid-transition.
 */
export const PAGE_DIM = 0.85;

export const STAGGER = {
  step: 30,
  /** Beyond this the entrance already reads as staggered, and waiting longer
      only delays the content. Keeps the whole run inside 300 ms. */
  maxSteps: 8,
} as const;

export function staggerDelay(index: number): number {
  if (!(index > 0)) return 0;
  return Math.min(index, STAGGER.maxSteps) * STAGGER.step;
}

export interface BarTransform {
  scaleX: number;
  translateX: number;
}

/**
 * A progress bar filled by scaling rather than by resizing.
 *
 * scaleX pivots on the centre and React Native has no transformOrigin, so the
 * bar is pushed left by half of the width the scale removed. Apply the two in
 * the order returned: `transform: [{ translateX }, { scaleX }]`.
 */
export function barTransform(trackWidth: number, progress: number): BarTransform {
  const scaleX = Math.min(Math.max(progress, 0), 1);
  const shift = (trackWidth * (1 - scaleX)) / 2;
  return { scaleX, translateX: shift === 0 ? 0 : -shift };
}

/** Where a counting number stands at progress `t`. */
export function countUpValue(from: number, to: number, t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return from + (to - from) * clamped;
}
