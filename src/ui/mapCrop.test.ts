import { describe, expect, test } from 'vitest';
import { cropOffset, steadySize } from './mapCrop';

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

// The keyboard shrinks the window. A map that followed would rebuild its surface and
// redraw the fog each time, in the middle of whatever was animating.
describe('steadySize', () => {
  const page = { width: 360, height: 780 };

  test('does not shrink for the keyboard', () => {
    expect(steadySize(page, { width: 360, height: 480 })).toBe(page);
  });

  test('takes a page that has grown', () => {
    expect(steadySize(page, { width: 360, height: 800 })).toEqual({ width: 360, height: 800 });
  });

  test('takes a new width, which no keyboard makes', () => {
    expect(steadySize(page, { width: 400, height: 700 })).toEqual({ width: 400, height: 700 });
  });

  test('hands back the same size when nothing changed, so nothing renders', () => {
    expect(steadySize(page, { width: 360, height: 780 })).toBe(page);
  });
});
