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
  /** Something leaving: quicker than arriving, since the user asked it to go. */
  exit: 180,
  /** A whole page sliding past. Distance earns the extra time. */
  page: 280,
  /** A bar filling: slow enough to read as filling rather than jumping. */
  bar: 420,
  /** Digits counting up. */
  count: 520,
  /** A pressed control coming back up. Going down is instant. */
  press: 160,
  /** A control with a long-press settling deeper while the finger holds. */
  hold: 380,
  /** Old text leaving a button. Quick: the user's eye is already on the new one. */
  swapOut: 90,
  /** New text arriving. */
  swapIn: 140,
} as const;

/**
 * How far a pressed control shrinks. Felt, not seen: past about 0.96 it visibly
 * collapses and draws the eye to the shrinking rather than to what it did.
 */
export const PRESS_SCALE = 0.97;

/**
 * How far a control with a long-press action sinks while held, so the thumb sees
 * that holding is doing something before the confirmation arrives.
 */
export const LONG_PRESS_SCALE = 0.945;

/** How far text travels as it swaps, in points. Enough to read as a change. */
export const SWAP_OFFSET = 4;

/** Cubic-bezier control points, for Easing.bezier. */
export const CURVE = {
  /** Entrances. Decisive start, long settle. */
  enter: [0.22, 1, 0.36, 1],
  /** Things travelling across the screen. */
  move: [0.25, 1, 0.5, 1],
} as const;

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

/** Where a sliding pill indicator sits on a row of equal-width slots. */
export function pillOffset(index: number, itemWidth: number, gap: number): number {
  if (!(index > 0)) return 0;
  return index * (itemWidth + gap);
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

/**
 * Whether two values read the same once formatted — in which case counting from
 * one to the other would run the JS thread for the length of an animation to
 * move nothing anyone can see. A number on the map changes with every few
 * metres walked but is shown to two decimals.
 */
export function sameShown(from: number, to: number, format: (value: number) => string): boolean {
  return format(from) === format(to);
}

/**
 * Whether a number should count from `from` to `to`, or just be the new value.
 *
 * It counts only for a change that shows. And it does not count up from zero
 * unless the screen is being arrived at: a number that sits at zero before
 * anything has loaded and then becomes the real figure has not "grown", it has
 * been filled in, and counting it up would replay at every launch.
 */
export function shouldCount(change: {
  from: number;
  to: number;
  arriving: boolean;
  format: (value: number) => string;
}): boolean {
  const { from, to, arriving, format } = change;

  if (from === to) return false;
  if (sameShown(from, to, format)) return false;
  if (from === 0 && !arriving) return false;

  return true;
}

/**
 * Whether a live number update should do a vertical flip impulse.
 *
 * On the map card a single step (e.g. 1.23 km -> 1.24 km) has no intermediate
 * formatted values for count-up to pass through, so without a flip impulse the
 * text would sit still and then snap. On arrival, count-up already runs from 0.
 */
export function shouldFlip(change: {
  from: number;
  to: number;
  arriving: boolean;
  format: (value: number) => string;
}): boolean {
  if (change.arriving) return false;
  return shouldCount(change);
}

export interface SpringPhysics {
  stiffness: number;
  damping: number;
  mass: number;
  restDisplacementThreshold: number;
  restSpeedThreshold: number;
}

/**
 * Apple's (responseSeconds, dampingRatio) spring converted to stiffness/damping/mass,
 * as iOS describes a spring: ω = 2π / response, stiffness = ω², damping = 2ζω.
 * Threshold 0.0005 is ~1 px on a 2340 px screen so the last frame never snaps.
 */
export function springForResponse(responseSeconds: number, dampingRatio = 1): SpringPhysics {
  const omega = (2 * Math.PI) / responseSeconds;
  return {
    stiffness: omega * omega,
    damping: 2 * dampingRatio * omega,
    mass: 1,
    restDisplacementThreshold: 0.0005,
    restSpeedThreshold: 0.005,
  };
}

/**
 * Full-screen sheet open/close springs:
 * critically damped (ζ = 1, no bounce), closing faster than opening (0.30 s vs 0.42 s).
 */
export const SCREEN_SPRING = {
  open: springForResponse(0.42, 1),
  close: springForResponse(0.3, 1),
} as const;

/** Vertical translation for a full-screen sheet at progress 0 (shut) .. 1 (open). */
export function slideOffsetPx(progress: number, screenHeight: number): number {
  const clamped = Math.min(Math.max(progress, 0), 1);
  const offset = (1 - clamped) * screenHeight;
  return offset === 0 ? 0 : offset;
}
