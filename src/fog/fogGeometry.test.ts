import { describe, expect, it } from 'vitest';
import { setBit } from './bitmap';
import { fogFeature, type TileBitmap } from './geojson';
import { createFogBuilder } from './fogGeometry';

const BYTES = (128 * 128) / 8;

function tile(x: number, y: number, cells: Array<[number, number]>): TileBitmap {
  const bitmap = new Uint8Array(BYTES);
  for (const [bx, by] of cells) setBit(bitmap, bx, by);
  return { x, y, bitmap };
}

/** loadAllTiles hands back freshly allocated arrays on every read. */
function reread(tiles: TileBitmap[]): TileBitmap[] {
  return tiles.map((t) => ({ x: t.x, y: t.y, bitmap: Uint8Array.from(t.bitmap) }));
}

describe('createFogBuilder', () => {
  const tiles = [
    tile(100, 200, [[4, 4], [5, 4], [4, 5]]),
    tile(101, 200, [[9, 9]]),
  ];

  it('builds what the stateless version builds', () => {
    expect(createFogBuilder().build(tiles)).toEqual(fogFeature(tiles));
  });

  it('reuses the rings of a tile that has not changed', () => {
    const builder = createFogBuilder();
    const first = builder.build(tiles);
    const second = builder.build(reread(tiles));

    // Same ring objects, not merely equal ones: nothing was traced again.
    expect(second.geometry.coordinates[1]).toBe(first.geometry.coordinates[1]);
    expect(second.geometry.coordinates[2]).toBe(first.geometry.coordinates[2]);
  });

  it('retraces only the tile whose bitmap moved', () => {
    const builder = createFogBuilder();
    const first = builder.build(tiles);

    const next = reread(tiles);
    setBit(next[0].bitmap, 40, 40);
    const second = builder.build(next);

    expect(second.geometry.coordinates[1]).not.toBe(first.geometry.coordinates[1]);
    expect(second.geometry.coordinates).toContain(first.geometry.coordinates[2]);
    expect(second).toEqual(fogFeature(next));
  });

  it('forgets tiles that are no longer there', () => {
    const builder = createFogBuilder();
    builder.build(tiles);
    const shrunk = builder.build([reread(tiles)[1]]);

    expect(shrunk).toEqual(fogFeature([tiles[1]]));
    expect(builder.size).toBe(1);
  });

  it('holds one entry per tile however often it is rebuilt', () => {
    const builder = createFogBuilder();
    for (let i = 0; i < 5; i++) builder.build(reread(tiles));
    expect(builder.size).toBe(2);
  });
});
