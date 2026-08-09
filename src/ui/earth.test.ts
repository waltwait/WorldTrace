import { describe, expect, test } from 'vitest';
import { EARTH_SURFACE_SQUARE_METERS, compareToLandmark, formatEarthShare } from './earth';

describe('formatEarthShare', () => {
  test('is zero before anything has been explored', () => {
    expect(formatEarthShare(0)).toBe('0%');
  });

  test('reads as a Chinese fraction rather than scientific notation', () => {
    // 0.0580 km² is about a ten-billionth of the planet. As "1.1 × 10⁻⁸%" it
    // was unreadable; as a denominator it is a number people already use.
    expect(formatEarthShare(58_000)).toBe('88 億分之一');
  });

  test('never falls back to an exponent', () => {
    for (const area of [1, 100, 58_000, 1_000_000, 100_000_000, 5_100_000_000]) {
      expect(formatEarthShare(area)).not.toMatch(/10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]/);
    }
  });

  test('steps down through the Chinese magnitudes as the area grows', () => {
    expect(formatEarthShare(1_000_000)).toBe('5.1 億分之一');
    expect(formatEarthShare(100_000_000)).toBe('510 萬分之一');
    expect(formatEarthShare(5_100_000_000)).toBe('10 萬分之一');
  });

  test('uses 兆 for an area too small to register any other way', () => {
    // A single square metre. Without 兆 this would read "510000 億分之一".
    expect(formatEarthShare(1)).toBe('510 兆分之一');
  });

  test('drops the decimal once the leading number is big enough to not need it', () => {
    // Below ten, one decimal carries real information; above it, it is noise.
    expect(formatEarthShare(1_000_000)).toMatch(/^5\.1 /);
    expect(formatEarthShare(58_000)).toMatch(/^88 /);
  });

  test('hands over to a percentage once one is legible', () => {
    // A denominator under ten thousand reads worse than the percentage it
    // replaces: "1 萬分之一" and "0.01%" say the same thing, and the second is
    // the one that keeps working as the number grows.
    const onePercent = EARTH_SURFACE_SQUARE_METERS * 0.01;

    expect(formatEarthShare(onePercent)).toBe('1.00%');
  });

  test('reads as a hundred percent for the whole planet', () => {
    expect(formatEarthShare(EARTH_SURFACE_SQUARE_METERS)).toBe('100.00%');
  });

  test('changes over exactly at the 萬 boundary, with no gap', () => {
    const tenThousandth = EARTH_SURFACE_SQUARE_METERS / 10_000;

    expect(formatEarthShare(tenThousandth)).toBe('0.01%');
    expect(formatEarthShare(tenThousandth * 0.9)).toContain('分之一');
  });

  test('keeps significant digits rather than rounding to zero', () => {
    const share = formatEarthShare(1_000_000_000);

    expect(share).not.toBe('0%');
    expect(share).not.toBe('0.00%');
  });
});

describe('compareToLandmark', () => {
  test('says nothing before anything has been explored', () => {
    expect(compareToLandmark(0)).toBeNull();
  });

  test('compares a small area to a basketball court', () => {
    expect(compareToLandmark(500)).toContain('籃球場');
  });

  test('compares a few thousand square metres to a football pitch', () => {
    // A pitch is 7,140 m²; anything under that is still counted in courts.
    expect(compareToLandmark(8000)).toContain('足球場');
    expect(compareToLandmark(7000)).toContain('籃球場');
  });

  test('steps up to a park once the area is big enough', () => {
    expect(compareToLandmark(300_000)).toContain('大安森林公園');
  });

  test('steps up to a city, then to the whole island', () => {
    expect(compareToLandmark(300_000_000)).toContain('台北市');
    expect(compareToLandmark(40_000_000_000)).toContain('台灣');
  });

  test('reports a multiple, so the number keeps meaning something', () => {
    expect(compareToLandmark(14_280)).toMatch(/2(\.0)? 座足球場/);
  });

  test('never picks a landmark bigger than the area itself', () => {
    // Otherwise the app would say "0.001 of Taiwan" for a morning walk.
    expect(compareToLandmark(500)).not.toContain('台灣');
    expect(compareToLandmark(500)).not.toContain('台北市');
  });
});
