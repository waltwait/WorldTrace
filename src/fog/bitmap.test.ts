import { describe, expect, test } from 'vitest';
import { TILE_BITS } from './tiles';
import { TILE_BYTES, createTile, getBit, popcount, setBit } from './bitmap';

describe('createTile', () => {
  test('is 2048 bytes, one bit per 128x128 cell', () => {
    expect(TILE_BYTES).toBe((TILE_BITS * TILE_BITS) / 8);
    expect(createTile()).toHaveLength(2048);
  });

  test('starts fully fogged', () => {
    const tile = createTile();

    expect(popcount(tile)).toBe(0);
    expect(getBit(tile, 0, 0)).toBe(false);
    expect(getBit(tile, 127, 127)).toBe(false);
  });
});

describe('setBit', () => {
  test('marks the cell as explored', () => {
    const tile = createTile();

    setBit(tile, 42, 99);

    expect(getBit(tile, 42, 99)).toBe(true);
  });

  test('reports whether the cell was newly explored', () => {
    const tile = createTile();

    expect(setBit(tile, 42, 99)).toBe(true);
    expect(setBit(tile, 42, 99)).toBe(false);
  });

  test('leaves neighbouring cells fogged', () => {
    const tile = createTile();

    setBit(tile, 42, 99);

    expect(getBit(tile, 41, 99)).toBe(false);
    expect(getBit(tile, 43, 99)).toBe(false);
    expect(getBit(tile, 42, 98)).toBe(false);
    expect(getBit(tile, 42, 100)).toBe(false);
    expect(popcount(tile)).toBe(1);
  });

  test('handles both corners of the tile', () => {
    const tile = createTile();

    setBit(tile, 0, 0);
    setBit(tile, 127, 127);

    expect(getBit(tile, 0, 0)).toBe(true);
    expect(getBit(tile, 127, 127)).toBe(true);
    expect(popcount(tile)).toBe(2);
  });
});

describe('popcount', () => {
  test('counts every explored cell', () => {
    const tile = createTile();

    for (let i = 0; i < TILE_BITS; i++) setBit(tile, i, i);

    expect(popcount(tile)).toBe(TILE_BITS);
  });

  test('counts a fully explored tile', () => {
    const tile = createTile();
    tile.fill(0xff);

    expect(popcount(tile)).toBe(TILE_BITS * TILE_BITS);
  });
});
