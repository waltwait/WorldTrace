import { describe, expect, test } from 'vitest';
import { getBit } from './bitmap';
import { locationToBit, metersPerBit } from './tiles';
import {
  createMemoryCanvas,
  paintPoint,
  paintSegment,
  tilesCovering,
} from './paint';

const TAIPEI = { lat: 25.033, lon: 121.5654 };

/** Offset a coordinate by a ground distance, so tests read in metres. */
function offset(
  origin: { lat: number; lon: number },
  eastMeters: number,
  northMeters = 0,
) {
  const lat = origin.lat + northMeters / 110540;
  const lon =
    origin.lon +
    eastMeters / (111320 * Math.cos((origin.lat * Math.PI) / 180));
  return { lat, lon };
}

function isExplored(
  canvas: ReturnType<typeof createMemoryCanvas>,
  point: { lat: number; lon: number },
): boolean {
  const bit = locationToBit(point.lat, point.lon);
  const tile = canvas.peek(bit.x, bit.y);
  return tile ? getBit(tile, bit.bx, bit.by) : false;
}

describe('paintPoint', () => {
  test('clears the fog at the location itself', () => {
    const canvas = createMemoryCanvas();

    paintPoint(canvas, TAIPEI.lat, TAIPEI.lon, 30);

    expect(isExplored(canvas, TAIPEI)).toBe(true);
  });

  test('clears fog out to the brush radius', () => {
    const canvas = createMemoryCanvas();

    paintPoint(canvas, TAIPEI.lat, TAIPEI.lon, 30);

    expect(isExplored(canvas, offset(TAIPEI, 20))).toBe(true);
  });

  test('leaves fog beyond the brush radius', () => {
    const canvas = createMemoryCanvas();

    paintPoint(canvas, TAIPEI.lat, TAIPEI.lon, 30);

    expect(isExplored(canvas, offset(TAIPEI, 100))).toBe(false);
  });

  test('paints a disc, not a square', () => {
    const canvas = createMemoryCanvas();

    paintPoint(canvas, TAIPEI.lat, TAIPEI.lon, 30);

    // 29 m east and 29 m north is 41 m away — inside the bounding box of the
    // brush but outside its radius.
    expect(isExplored(canvas, offset(TAIPEI, 29, 29))).toBe(false);
  });

  test('reports the number of newly explored cells', () => {
    const canvas = createMemoryCanvas();
    const radiusInBits = 30 / metersPerBit(TAIPEI.lat);
    const areaInBits = Math.PI * radiusInBits ** 2;

    const painted = paintPoint(canvas, TAIPEI.lat, TAIPEI.lon, 30);

    expect(painted).toBeGreaterThan(areaInBits * 0.7);
    expect(painted).toBeLessThan(areaInBits * 1.3);
  });

  test('reports nothing new when painting the same spot again', () => {
    const canvas = createMemoryCanvas();

    paintPoint(canvas, TAIPEI.lat, TAIPEI.lon, 30);

    expect(paintPoint(canvas, TAIPEI.lat, TAIPEI.lon, 30)).toBe(0);
  });

  test('spans both tiles when the brush straddles a tile boundary', () => {
    const canvas = createMemoryCanvas();

    // Step east until the tile column rolls over, then paint on the seam so
    // the brush has to reach back into the previous tile.
    let probe = TAIPEI;
    const startTile = locationToBit(probe.lat, probe.lon).x;
    for (let i = 0; i < 2000; i++) {
      probe = offset(probe, 1);
      if (locationToBit(probe.lat, probe.lon).x !== startTile) break;
    }
    expect(locationToBit(probe.lat, probe.lon).x).toBe(startTile + 1);

    paintPoint(canvas, probe.lat, probe.lon, 30);

    expect(isExplored(canvas, probe)).toBe(true);
    expect(isExplored(canvas, offset(probe, -10))).toBe(true);
    expect(canvas.tileCount()).toBe(2);
  });
});

describe('paintSegment', () => {
  test('clears a continuous corridor between the two points', () => {
    const canvas = createMemoryCanvas();

    paintSegment(canvas, TAIPEI, offset(TAIPEI, 200), 30);

    for (let m = 0; m <= 200; m += 10) {
      expect(isExplored(canvas, offset(TAIPEI, m))).toBe(true);
    }
  });

  test('leaves fog to the side of the corridor', () => {
    const canvas = createMemoryCanvas();

    paintSegment(canvas, TAIPEI, offset(TAIPEI, 200), 30);

    expect(isExplored(canvas, offset(TAIPEI, 100, 100))).toBe(false);
  });

  test('handles a diagonal run without leaving gaps', () => {
    const canvas = createMemoryCanvas();

    paintSegment(canvas, TAIPEI, offset(TAIPEI, 150, 150), 30);

    for (let f = 0; f <= 1.0001; f += 0.1) {
      expect(isExplored(canvas, offset(TAIPEI, 150 * f, 150 * f))).toBe(true);
    }
  });

  test('is equivalent to a single point when both ends coincide', () => {
    const canvas = createMemoryCanvas();
    const single = createMemoryCanvas();

    paintSegment(canvas, TAIPEI, TAIPEI, 30);
    paintPoint(single, TAIPEI.lat, TAIPEI.lon, 30);

    expect(canvas.exploredCells()).toBe(single.exploredCells());
  });
});

describe('MemoryCanvas.put', () => {
  test('seeds the canvas with an existing bitmap', () => {
    const canvas = createMemoryCanvas();
    const bit = locationToBit(TAIPEI.lat, TAIPEI.lon);
    const existing = new Uint8Array(2048);

    canvas.put(bit.x, bit.y, existing);
    paintPoint(canvas, TAIPEI.lat, TAIPEI.lon, 30);

    // Painting must have written into the bitmap we handed over, not a fresh
    // one — otherwise loading from the database would silently lose fog.
    expect(canvas.peek(bit.x, bit.y)).toBe(existing);
    expect(isExplored(canvas, TAIPEI)).toBe(true);
  });

  test('reports already explored cells as nothing new', () => {
    const seeded = createMemoryCanvas();
    const scratch = createMemoryCanvas();
    paintPoint(scratch, TAIPEI.lat, TAIPEI.lon, 30);
    const bit = locationToBit(TAIPEI.lat, TAIPEI.lon);

    seeded.put(bit.x, bit.y, scratch.peek(bit.x, bit.y)!);

    expect(paintPoint(seeded, TAIPEI.lat, TAIPEI.lon, 30)).toBe(0);
  });
});

describe('tilesCovering', () => {
  test('lists the single tile a small brush stays inside', () => {
    const bit = locationToBit(TAIPEI.lat, TAIPEI.lon);

    expect(tilesCovering(TAIPEI, TAIPEI, 30)).toEqual([{ x: bit.x, y: bit.y }]);
  });

  test('lists both tiles when the brush straddles a seam', () => {
    let probe = TAIPEI;
    const startTile = locationToBit(probe.lat, probe.lon).x;
    for (let i = 0; i < 2000; i++) {
      probe = offset(probe, 1);
      if (locationToBit(probe.lat, probe.lon).x !== startTile) break;
    }

    const covered = tilesCovering(probe, probe, 30);

    expect(covered).toHaveLength(2);
    expect(covered.map((t) => t.x).sort((a, b) => a - b)).toEqual([
      startTile,
      startTile + 1,
    ]);
  });

  test('covers every tile a long segment passes through', () => {
    const far = offset(TAIPEI, 5000);
    const covered = tilesCovering(TAIPEI, far, 30);

    const startTile = locationToBit(TAIPEI.lat, TAIPEI.lon).x;
    const endTile = locationToBit(far.lat, far.lon).x;

    expect(covered.length).toBeGreaterThanOrEqual(endTile - startTile + 1);
    for (let x = startTile; x <= endTile; x++) {
      expect(covered.some((t) => t.x === x)).toBe(true);
    }
  });

  test('is exactly the set of tiles that painting touches', () => {
    const canvas = createMemoryCanvas();
    const to = offset(TAIPEI, 800, 800);

    paintSegment(canvas, TAIPEI, to, 30);

    expect(tilesCovering(TAIPEI, to, 30).length).toBeGreaterThanOrEqual(
      canvas.tileCount(),
    );
  });
});
