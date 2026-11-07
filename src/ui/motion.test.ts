import { describe, expect, it } from 'vitest';
import {
  barTransform,
  countUpValue,
  DURATION,
  LONG_PRESS_SCALE,
  pillOffset,
  PRESS_SCALE,
  sameShown,
  SCREEN_SPRING,
  shouldCount,
  shouldFlip,
  slideOffsetPx,
  springForResponse,
  staggerDelay,
  STAGGER,
  SWAP_OFFSET,
} from './motion';

describe('staggerDelay', () => {
  it('walks the first few items apart', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBe(30);
    expect(staggerDelay(3)).toBe(90);
  });

  // A year of walking is a few hundred days in the timeline. Multiplying the
  // index would leave the last card waiting a quarter of a minute to appear.
  it('stops adding delay once the entrance has read as staggered', () => {
    expect(staggerDelay(400)).toBe(staggerDelay(STAGGER.maxSteps));
    expect(staggerDelay(400)).toBeLessThanOrEqual(300);
  });

  it('treats a nonsense index as the first one', () => {
    expect(staggerDelay(-3)).toBe(0);
  });
});

describe('barTransform', () => {
  // scaleX pivots on the centre and React Native has no transformOrigin, so
  // the bar has to be pushed back by half of what the scale took off it.
  it('leaves a full bar alone', () => {
    expect(barTransform(200, 1)).toEqual({ scaleX: 1, translateX: 0 });
  });

  it('pins a half-full bar to the left edge of its track', () => {
    const { scaleX, translateX } = barTransform(200, 0.5);
    expect(scaleX).toBe(0.5);
    // Left edge: centre 100, minus half the scaled width 50, plus translateX.
    expect(100 - (200 * scaleX) / 2 + translateX).toBe(0);
  });

  it('pins an almost-empty bar to the same edge', () => {
    const w = 340;
    const { scaleX, translateX } = barTransform(w, 0.02);
    expect(w / 2 - (w * scaleX) / 2 + translateX).toBeCloseTo(0);
  });

  it('clamps progress that came out of a stale ratio', () => {
    expect(barTransform(200, 1.4).scaleX).toBe(1);
    expect(barTransform(200, -0.2).scaleX).toBe(0);
  });

  it('survives being asked before the track has been laid out', () => {
    expect(barTransform(0, 0.5)).toEqual({ scaleX: 0.5, translateX: 0 });
  });
});

describe('countUpValue', () => {
  it('runs from the old number to the new one', () => {
    expect(countUpValue(10, 20, 0)).toBe(10);
    expect(countUpValue(10, 20, 0.5)).toBe(15);
    expect(countUpValue(10, 20, 1)).toBe(20);
  });

  it('never overshoots the number it is counting to', () => {
    expect(countUpValue(10, 20, 1.5)).toBe(20);
    expect(countUpValue(10, 20, -1)).toBe(10);
  });

  it('counts downwards too', () => {
    expect(countUpValue(20, 10, 0.5)).toBe(15);
  });
});

describe('press feedback', () => {
  // Press feedback should be felt, not seen: past about 0.96 the control visibly
  // collapses and the eye goes to the shrinking instead of to what it did.
  it('shrinks a control only a little', () => {
    expect(PRESS_SCALE).toBeGreaterThanOrEqual(0.96);
    expect(PRESS_SCALE).toBeLessThan(1);
    expect(PRESS_SCALE).toBeLessThanOrEqual(0.98);
  });

  it('lets go slower than it grabbed, which was instant', () => {
    expect(DURATION.press).toBeGreaterThan(0);
    expect(DURATION.press).toBeLessThanOrEqual(200);
  });
});

describe('text swap', () => {
  it('goes out faster than it comes in', () => {
    expect(DURATION.swapOut).toBeLessThan(DURATION.swapIn);
  });

  // The old text leaves and the new arrives one after the other, and both are on
  // the button the user is looking at: the pair has to be over before they have
  // time to wonder.
  it('is over inside 300 ms, both halves together', () => {
    expect(DURATION.swapOut + DURATION.swapIn).toBeLessThan(300);
  });

  it('moves only a few points, enough to read as a change and no more', () => {
    expect(SWAP_OFFSET).toBeGreaterThan(0);
    expect(SWAP_OFFSET).toBeLessThanOrEqual(8);
  });
});

describe('sameShown', () => {
  const area = (value: number) => `${value.toFixed(2)} km²`;

  // A number on the map moves with every few metres walked, but it is shown to
  // two decimals. Counting up between two values that read the same would run
  // the JS thread for half a second to move nothing the eye can see.
  it('is true when two values read the same once formatted', () => {
    expect(sameShown(70.0201, 70.0249, area)).toBe(true);
  });

  it('is false when the reading changes', () => {
    expect(sameShown(70.02, 70.03, area)).toBe(false);
  });

  it('is decided by the formatter, not by the raw values', () => {
    expect(sameShown(1, 2, () => 'same')).toBe(true);
    expect(sameShown(1, 1, (value) => String(value + Math.random()))).toBe(false);
  });
});

describe('shouldCount', () => {
  const area = (value: number) => `${value.toFixed(2)} km²`;

  it('counts when the value moves and the reading changes', () => {
    expect(shouldCount({ from: 70.02, to: 70.5, arriving: false, format: area })).toBe(true);
  });

  it('does not count when nothing moves', () => {
    expect(shouldCount({ from: 70.02, to: 70.02, arriving: false, format: area })).toBe(false);
  });

  it('does not count a change that reads the same', () => {
    expect(shouldCount({ from: 70.021, to: 70.024, arriving: false, format: area })).toBe(false);
  });

  // The map's number starts at zero before anything has loaded and then jumps to
  // the real figure. Counting up from nothing there would replay at every launch,
  // at the moment the JS thread is busiest and for no reason the user gave.
  it('does not count up from zero unless the screen is being arrived at', () => {
    expect(shouldCount({ from: 0, to: 70.02, arriving: false, format: area })).toBe(false);
  });

  it('does count up from zero on arriving, which is what the stats screen wants', () => {
    expect(shouldCount({ from: 0, to: 70.02, arriving: true, format: area })).toBe(true);
  });

  it('still carries on from a nonzero value that is not an arrival', () => {
    expect(shouldCount({ from: 12.5, to: 13, arriving: false, format: area })).toBe(true);
  });
});

describe('shouldFlip', () => {
  const area = (value: number) => `${value.toFixed(2)} km²`;

  it('flips on a live tick that changes the formatted reading', () => {
    expect(shouldFlip({ from: 70.02, to: 70.03, arriving: false, format: area })).toBe(true);
  });

  it('does not flip when arriving on a screen, where count-up already runs', () => {
    expect(shouldFlip({ from: 0, to: 70.02, arriving: true, format: area })).toBe(false);
  });

  it('does not flip when initial data fills in from zero on launch', () => {
    expect(shouldFlip({ from: 0, to: 70.02, arriving: false, format: area })).toBe(false);
  });

  it('does not flip when the formatted text is unchanged', () => {
    expect(shouldFlip({ from: 70.021, to: 70.024, arriving: false, format: area })).toBe(false);
  });
});

describe('long-press and exit feedback', () => {
  it('settles deeper than an ordinary tap while a hold is building', () => {
    expect(LONG_PRESS_SCALE).toBeLessThan(PRESS_SCALE);
    expect(LONG_PRESS_SCALE).toBeGreaterThanOrEqual(0.93);
  });

  it('reaches the hold depth before the OS long-press fires (~500 ms)', () => {
    expect(DURATION.hold).toBeGreaterThan(200);
    expect(DURATION.hold).toBeLessThan(500);
  });

  it('leaves faster than an entrance arrives', () => {
    expect(DURATION.exit).toBeGreaterThan(0);
    expect(DURATION.exit).toBeLessThan(DURATION.enter);
  });
});

describe('pillOffset', () => {
  it('places the indicator on the chosen slot', () => {
    expect(pillOffset(0, 56, 4)).toBe(0);
    expect(pillOffset(1, 56, 4)).toBe(60);
    expect(pillOffset(3, 56, 4)).toBe(180);
  });

  it('clamps a negative index to the first slot', () => {
    expect(pillOffset(-1, 56, 4)).toBe(0);
  });
});

describe('full-screen spring', () => {
  it('computes a critically damped spring (c² = 4km) when dampingRatio is 1', () => {
    const spec = springForResponse(0.42, 1);
    expect(spec.mass).toBe(1);
    expect(spec.stiffness).toBeCloseTo(((2 * Math.PI) / 0.42) ** 2, 4);
    expect(spec.damping ** 2).toBeCloseTo(4 * spec.stiffness * spec.mass, 4);
  });

  it('closes faster than it opens, with sub-pixel rest threshold on tall phones', () => {
    expect(SCREEN_SPRING.close.stiffness).toBeGreaterThan(SCREEN_SPRING.open.stiffness);
    expect(SCREEN_SPRING.open.restDisplacementThreshold).toBeLessThanOrEqual(0.0005);
    expect(SCREEN_SPRING.close.restDisplacementThreshold).toBeLessThanOrEqual(0.0005);
  });

  it('maps progress 0..1 to screenHeight..0 for vertical slide', () => {
    expect(slideOffsetPx(0, 840)).toBe(840);
    expect(slideOffsetPx(0.5, 840)).toBe(420);
    expect(slideOffsetPx(1, 840)).toBe(0);
    expect(slideOffsetPx(1.05, 840)).toBe(0);
  });
});
