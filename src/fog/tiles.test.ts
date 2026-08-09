import { describe, expect, test } from 'vitest';
import {
  FOG_ZOOM,
  TILE_BITS,
  globalBitToLocation,
  locationToBit,
  locationToGlobalBit,
  metersPerBit,
} from './tiles';

describe('globalBitToLocation', () => {
  test('round-trips a coordinate back to itself', () => {
    const lat = 25.033;
    const lon = 121.5654;

    const { gx, gy } = locationToGlobalBit(lat, lon);
    const back = globalBitToLocation(gx, gy);

    expect(back.lat).toBeCloseTo(lat, 9);
    expect(back.lon).toBeCloseTo(lon, 9);
  });

  test('round-trips across hemispheres', () => {
    for (const [lat, lon] of [
      [-33.8688, 151.2093],
      [64.1466, -21.9426],
      [0, 0],
      [-54.8, -68.3],
    ]) {
      const { gx, gy } = locationToGlobalBit(lat, lon);
      const back = globalBitToLocation(gx, gy);

      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  test('maps the centre of the grid to null island', () => {
    const centre = globalBitToLocation(32768 * TILE_BITS, 32768 * TILE_BITS);

    expect(centre.lat).toBeCloseTo(0, 9);
    expect(centre.lon).toBeCloseTo(0, 9);
  });
});

describe('locationToGlobalBit', () => {
  test('keeps the fractional position inside the bit', () => {
    const { gx, gy } = locationToGlobalBit(0, 0);

    expect(gx).toBeCloseTo(32768 * TILE_BITS, 5);
    expect(gy).toBeCloseTo(32768 * TILE_BITS, 5);
  });

  test('agrees with locationToBit once floored', () => {
    const lat = 25.033;
    const lon = 121.5654;
    const { gx, gy } = locationToGlobalBit(lat, lon);
    const bit = locationToBit(lat, lon);

    expect(Math.floor(gx / TILE_BITS)).toBe(bit.x);
    expect(Math.floor(gy / TILE_BITS)).toBe(bit.y);
    expect(Math.floor(gx) % TILE_BITS).toBe(bit.bx);
    expect(Math.floor(gy) % TILE_BITS).toBe(bit.by);
  });

  test('advances one bit per metersPerBit of easting', () => {
    const lat = 25.033;
    const lon = 121.5654;
    const metresEast = metersPerBit(lat) * 10;
    const dLon = (metresEast / (111320 * Math.cos((lat * Math.PI) / 180))) * 1;

    const from = locationToGlobalBit(lat, lon);
    const to = locationToGlobalBit(lat, lon + dLon);

    expect(to.gx - from.gx).toBeCloseTo(10, 0);
  });
});

describe('locationToBit', () => {
  test('maps null island to the exact centre of the tile grid', () => {
    // At z16 the grid is 2^16 tiles wide, so lon/lat 0 lands on the first bit
    // of tile (32768, 32768) — a value verifiable by hand from the Web
    // Mercator definition, independent of our implementation.
    expect(locationToBit(0, 0)).toEqual({ x: 32768, y: 32768, bx: 0, by: 0 });
  });

  test('places the antimeridian at the western edge of the grid', () => {
    expect(locationToBit(0, -180)).toMatchObject({ x: 0, bx: 0 });
  });

  test('increasing longitude never moves a point west', () => {
    const west = locationToBit(25.033, 121.5);
    const east = locationToBit(25.033, 121.6);
    const globalX = (b: { x: number; bx: number }) => b.x * TILE_BITS + b.bx;

    expect(globalX(east)).toBeGreaterThan(globalX(west));
  });

  test('increasing latitude moves a point north, which is a lower row index', () => {
    const south = locationToBit(25.0, 121.5);
    const north = locationToBit(25.1, 121.5);
    const globalY = (b: { y: number; by: number }) => b.y * TILE_BITS + b.by;

    expect(globalY(north)).toBeLessThan(globalY(south));
  });

  test('keeps bit indices inside the tile', () => {
    for (const [lat, lon] of [
      [25.033, 121.5654],
      [-33.8688, 151.2093],
      [64.1466, -21.9426],
      [0, 179.9999],
    ]) {
      const bit = locationToBit(lat, lon);
      expect(bit.bx).toBeGreaterThanOrEqual(0);
      expect(bit.bx).toBeLessThan(TILE_BITS);
      expect(bit.by).toBeGreaterThanOrEqual(0);
      expect(bit.by).toBeLessThan(TILE_BITS);
    }
  });

  test('resolves neighbouring points that are metres apart into distinct bits', () => {
    // ~30 m east of Taipei 101 must not collapse onto the same bit.
    const a = locationToBit(25.033, 121.5654);
    const b = locationToBit(25.033, 121.5657);

    expect(a).not.toEqual(b);
  });
});

describe('metersPerBit', () => {
  test('is about 4.8 m at the equator', () => {
    // 2^16 tiles * 128 bits spans 40,075 km of equator.
    expect(metersPerBit(0)).toBeCloseTo(4.777, 2);
  });

  test('shrinks with the cosine of latitude', () => {
    expect(metersPerBit(60)).toBeCloseTo(metersPerBit(0) * 0.5, 2);
  });
});

describe('FOG_ZOOM', () => {
  test('is fixed at 16 as the spec requires', () => {
    expect(FOG_ZOOM).toBe(16);
    expect(TILE_BITS).toBe(128);
  });
});
