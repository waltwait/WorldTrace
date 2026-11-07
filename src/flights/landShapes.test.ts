import { describe, expect, test } from 'vitest';
import { landRings } from './landShapes';

/** Even-odd: whether a point falls inside any ring. */
function onLand(lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of landRings()) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

describe('landRings', () => {
  test('are degrees of longitude and latitude', () => {
    for (const ring of landRings()) {
      for (const [lon, lat] of ring) {
        expect(Math.abs(lon)).toBeLessThanOrEqual(180.01);
        expect(Math.abs(lat)).toBeLessThanOrEqual(90.01);
      }
    }
  });

  test.each([
    ['Taipei', 121.5, 25.03],
    ['Tokyo', 139.7, 35.68],
    ['Paris', 2.35, 48.86],
    ['Singapore island', 103.82, 1.35],
  ])('have land under %s', (_, lon, lat) => {
    expect(onLand(lon, lat)).toBe(true);
  });

  test.each([
    ['the Pacific', -150, 20],
    ['the Taiwan Strait', 119.8, 24.3],
    ['the Sea of Japan', 135, 40],
  ])('have none under %s', (_, lon, lat) => {
    expect(onLand(lon, lat)).toBe(false);
  });

  test('are worked out once', () => {
    expect(landRings()).toBe(landRings());
  });
});
