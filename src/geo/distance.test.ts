import { describe, expect, test } from 'vitest';
import { distanceMeters } from './distance';

describe('distanceMeters', () => {
  test('is zero for a point against itself', () => {
    expect(distanceMeters({ lat: 25.033, lon: 121.5654 }, { lat: 25.033, lon: 121.5654 })).toBe(0);
  });

  test('measures a degree of latitude as about 111 km', () => {
    expect(distanceMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111195, -2);
  });

  test('measures a degree of longitude at the equator as about 111 km', () => {
    expect(distanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111195, -2);
  });

  test('shrinks a degree of longitude with latitude', () => {
    const atEquator = distanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    const atSixty = distanceMeters({ lat: 60, lon: 0 }, { lat: 60, lon: 1 });

    expect(atSixty).toBeCloseTo(atEquator * 0.5, -2);
  });

  test('is symmetric', () => {
    const a = { lat: 25.033, lon: 121.5654 };
    const b = { lat: 35.6762, lon: 139.6503 };

    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });

  test('measures Taipei to Tokyo as roughly 2100 km', () => {
    const distance = distanceMeters(
      { lat: 25.033, lon: 121.5654 },
      { lat: 35.6762, lon: 139.6503 },
    );

    expect(distance).toBeGreaterThan(2_050_000);
    expect(distance).toBeLessThan(2_150_000);
  });

  test('stays accurate over a few metres', () => {
    const from = { lat: 25.033, lon: 121.5654 };
    const to = { lat: 25.033, lon: 121.5654 + 10 / (111320 * Math.cos((25.033 * Math.PI) / 180)) };

    expect(distanceMeters(from, to)).toBeCloseTo(10, 1);
  });
});
