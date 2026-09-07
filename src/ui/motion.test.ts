import { describe, expect, it } from 'vitest';
import { barTransform, countUpValue, staggerDelay, STAGGER } from './motion';

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
