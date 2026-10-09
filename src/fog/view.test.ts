import { describe, expect, test } from 'vitest';
import {
  isUsableView,
  rangeContains,
  scaleForZoom,
  tileRangeOf,
  viewFromMap,
  type FogView,
} from './view';
import { locationToBit } from './tiles';

const TAIPEI = { lat: 25.033, lon: 121.5654 };
const HERE = locationToBit(TAIPEI.lat, TAIPEI.lon);

function around(lat: number, lon: number, half: number, zoom = 15): FogView {
  return { west: lon - half, south: lat - half, east: lon + half, north: lat + half, zoom };
}

describe('scaleForZoom', () => {
  test('keeps every cell once a cell is at least a pixel wide', () => {
    expect(scaleForZoom(14)).toBe(1);
    expect(scaleForZoom(15)).toBe(1);
    expect(scaleForZoom(18)).toBe(1);
    expect(scaleForZoom(22)).toBe(1);
  });

  test('widens the block as the map zooms out, so a block stays about a pixel', () => {
    expect(scaleForZoom(13)).toBe(2);
    expect(scaleForZoom(12)).toBe(4);
    expect(scaleForZoom(11)).toBe(8);
    expect(scaleForZoom(10)).toBe(16);
    expect(scaleForZoom(9)).toBe(32);
    expect(scaleForZoom(8)).toBe(64);
  });

  test('stops at one block per tile', () => {
    expect(scaleForZoom(7)).toBe(128);
    expect(scaleForZoom(3)).toBe(128);
    expect(scaleForZoom(-2)).toBe(128);
  });

  test('only widens a block while it stays within a pixel, and widens it as far as that allows', () => {
    // At zoom z a cell is 2^(z - 14) pixels, so scale * that is the block's size.
    for (let zoom = 0; zoom <= 22; zoom += 0.25) {
      const scale = scaleForZoom(zoom);
      const pixels = scale * 2 ** (zoom - 14);

      if (scale > 1) expect(pixels).toBeLessThanOrEqual(1);
      // One step wider would be over a pixel, unless the tile has run out.
      if (scale < 128) expect(pixels * 2).toBeGreaterThan(1);
    }
  });

  test('is always a power of two that divides the tile', () => {
    for (let zoom = 0; zoom <= 22; zoom += 0.25) {
      const scale = scaleForZoom(zoom);
      expect(128 % scale).toBe(0);
      expect(Math.log2(scale) % 1).toBe(0);
    }
  });
});

describe('isUsableView', () => {
  test('accepts what the map reports', () => {
    expect(isUsableView(around(TAIPEI.lat, TAIPEI.lon, 0.01))).toBe(true);
  });

  test('refuses a view with a missing or non-finite number', () => {
    expect(isUsableView({ ...around(0, 0, 1), zoom: NaN })).toBe(false);
    expect(isUsableView({ ...around(0, 0, 1), west: Infinity })).toBe(false);
    expect(isUsableView(null)).toBe(false);
  });

  test('refuses a view that is upside down', () => {
    expect(isUsableView({ ...around(0, 0, 1), south: 5, north: -5 })).toBe(false);
  });
});

describe('tileRangeOf', () => {
  test('covers the tile at the centre of the view', () => {
    const range = tileRangeOf(around(TAIPEI.lat, TAIPEI.lon, 0.0005));

    expect(range.x0).toBeLessThanOrEqual(HERE.x);
    expect(range.x1).toBeGreaterThanOrEqual(HERE.x);
    expect(range.y0).toBeLessThanOrEqual(HERE.y);
    expect(range.y1).toBeGreaterThanOrEqual(HERE.y);
  });

  test('is a single tile for a view that sits inside one', () => {
    const range = tileRangeOf({
      west: TAIPEI.lon,
      east: TAIPEI.lon + 1e-6,
      south: TAIPEI.lat,
      north: TAIPEI.lat + 1e-6,
      zoom: 17,
    });

    expect(range).toEqual({ x0: HERE.x, x1: HERE.x, y0: HERE.y, y1: HERE.y });
  });

  test('puts north above south, as tile rows run', () => {
    const range = tileRangeOf(around(TAIPEI.lat, TAIPEI.lon, 0.05));

    expect(range.y1).toBeGreaterThan(range.y0);
    expect(range.x1).toBeGreaterThan(range.x0);
  });

  test('grows by the margin on every side', () => {
    const view = around(TAIPEI.lat, TAIPEI.lon, 0.0005);
    const bare = tileRangeOf(view);
    const padded = tileRangeOf(view, 3);

    expect(padded).toEqual({
      x0: bare.x0 - 3,
      x1: bare.x1 + 3,
      y0: bare.y0 - 3,
      y1: bare.y1 + 3,
    });
  });

  test('stays inside the world', () => {
    const range = tileRangeOf(
      { west: -180, east: 180, south: -85.05, north: 85.05, zoom: 1 },
      5,
    );

    expect(range).toEqual({ x0: 0, y0: 0, x1: 65535, y1: 65535 });
  });

  test('clamps latitudes the projection cannot hold', () => {
    const range = tileRangeOf({ west: 0, east: 1, south: -89, north: 89, zoom: 2 });

    expect(range.y0).toBe(0);
    expect(range.y1).toBe(65535);
  });

  test('reads a view panned onto a copy of the world as the same ground', () => {
    const plain = tileRangeOf(around(TAIPEI.lat, TAIPEI.lon, 0.01));
    const copy = tileRangeOf(around(TAIPEI.lat, TAIPEI.lon + 360, 0.01));

    expect(copy).toEqual(plain);
  });

  test('takes every column when the view crosses the antimeridian', () => {
    const range = tileRangeOf({ west: 175, east: -175, south: -1, north: 1, zoom: 5 });

    expect(range.x0).toBe(0);
    expect(range.x1).toBe(65535);
  });

  test('takes every column when the view is wider than the world', () => {
    const range = tileRangeOf({ west: -300, east: 300, south: -1, north: 1, zoom: 0 });

    expect(range.x0).toBe(0);
    expect(range.x1).toBe(65535);
  });
});

describe('rangeContains', () => {
  const outer = { x0: 10, x1: 20, y0: 30, y1: 40 };

  test('holds a range inside it, edges included', () => {
    expect(rangeContains(outer, { x0: 10, x1: 20, y0: 30, y1: 40 })).toBe(true);
    expect(rangeContains(outer, { x0: 12, x1: 13, y0: 35, y1: 36 })).toBe(true);
  });

  test('does not hold one that pokes out on any side', () => {
    expect(rangeContains(outer, { ...outer, x0: 9 })).toBe(false);
    expect(rangeContains(outer, { ...outer, x1: 21 })).toBe(false);
    expect(rangeContains(outer, { ...outer, y0: 29 })).toBe(false);
    expect(rangeContains(outer, { ...outer, y1: 41 })).toBe(false);
  });
});

describe('viewFromMap', () => {
  test('reads the map\'s bounds as west, south, east, north', () => {
    expect(viewFromMap({ bounds: [121.5, 25.0, 121.6, 25.1], zoom: 15.5 })).toEqual({
      west: 121.5,
      south: 25.0,
      east: 121.6,
      north: 25.1,
      zoom: 15.5,
    });
  });

  test('puts the view over the ground the bounds describe', () => {
    const view = viewFromMap({ bounds: [121.55, 25.02, 121.58, 25.05], zoom: 15 });
    const range = tileRangeOf(view!);

    expect(range.x0).toBeLessThanOrEqual(HERE.x);
    expect(range.x1).toBeGreaterThanOrEqual(HERE.x);
    expect(range.y0).toBeLessThanOrEqual(HERE.y);
    expect(range.y1).toBeGreaterThanOrEqual(HERE.y);
  });

  test('is null for anything that is not a view', () => {
    expect(viewFromMap(null)).toBeNull();
    expect(viewFromMap(undefined)).toBeNull();
    expect(viewFromMap({ bounds: [1, 2, 3], zoom: 5 })).toBeNull();
    expect(viewFromMap({ bounds: [1, 2, 3, 4], zoom: NaN })).toBeNull();
    expect(viewFromMap({ bounds: [1, 9, 3, 4], zoom: 5 })).toBeNull();
  });
});
