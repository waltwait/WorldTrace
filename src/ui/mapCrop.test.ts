import { describe, expect, test } from 'vitest';
import { cropOffset } from './mapCrop';

describe('cropOffset', () => {
  const screen = { width: 360, height: 780 };

  test('puts the middle of the map in the middle of the tile', () => {
    const tile = { width: 328, height: 300 };
    const { left, top } = cropOffset(tile, screen);

    expect(left + screen.width / 2).toBe(tile.width / 2);
    expect(top + screen.height / 2).toBe(tile.height / 2);
  });

  test('moves nothing when the tile is the screen', () => {
    expect(cropOffset(screen, screen)).toEqual({ left: 0, top: 0 });
  });
});
