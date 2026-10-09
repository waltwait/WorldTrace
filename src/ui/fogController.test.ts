import { describe, expect, it } from 'vitest';
import { setBit } from '../fog/bitmap';
import type { TileBitmap } from '../fog/geojson';
import { globalBitToLocation, locationToBit, TILE_BITS } from '../fog/tiles';
import { createFogController, MOVING_REDRAW_GAP_MS } from './fogController';

const HERE = locationToBit(25.033, 121.5654);

function tile(x: number, y: number): TileBitmap {
  const bitmap = new Uint8Array((128 * 128) / 8);
  setBit(bitmap, 4, 4);
  return { x, y, bitmap };
}

/** What the map reports for a view that exactly fits tiles (x0, y0) to (x1, y1). */
function mapView(x0: number, y0: number, x1: number, y1: number, zoom = 16) {
  const northWest = globalBitToLocation(x0 * TILE_BITS + 1, y0 * TILE_BITS + 1);
  const southEast = globalBitToLocation((x1 + 1) * TILE_BITS - 1, (y1 + 1) * TILE_BITS - 1);
  return {
    bounds: [northWest.lon, southEast.lat, southEast.lon, northWest.lat],
    zoom,
  };
}

function setup() {
  let clock = 10_000;
  let redraws = 0;
  const controller = createFogController({
    requestRedraw: () => {
      redraws++;
    },
    now: () => clock,
  });
  const ground = [tile(HERE.x, HERE.y), tile(HERE.x + 1, HERE.y)];

  return {
    controller,
    ground,
    redraws: () => redraws,
    advance: (ms: number) => {
      clock += ms;
    },
    here: mapView(HERE.x, HERE.y, HERE.x + 1, HERE.y),
  };
}

describe('createFogController', () => {
  it('covers the world in fog until the map says where it is', () => {
    const { controller, ground } = setup();

    expect(controller.fogFor(ground).geometry.coordinates).toHaveLength(1);
  });

  it('asks for a redraw when it first learns where the map is', () => {
    const { controller, ground, here, redraws } = setup();
    controller.fogFor(ground);

    controller.view(here, false);

    expect(redraws()).toBe(1);
  });

  it('draws for the view it was told once it is asked again', () => {
    const { controller, ground, here } = setup();
    const blank = controller.fogFor(ground);
    controller.view(here, false);

    expect(controller.fogFor(ground)).not.toBe(blank);
  });

  /**
   * The map in follow mode reports its position on every frame, still or not —
   * about 120 times a second on a fast screen — and each report used to put a
   * new object into React state and render the whole map screen again.
   */
  it('does not ask for a redraw however often the map repeats the view it has drawn', () => {
    const { controller, ground, here, redraws } = setup();
    controller.fogFor(ground);
    controller.view(here, false);
    controller.fogFor(ground);
    const asked = redraws();

    for (let i = 0; i < 1000; i++) controller.view(here, false);

    expect(redraws()).toBe(asked);
  });

  it('does not ask for a redraw while the view creeps inside what was drawn', () => {
    const { controller, ground, here, redraws } = setup();
    controller.fogFor(ground);
    controller.view(here, false);
    controller.fogFor(ground);
    const asked = redraws();

    for (let i = 1; i <= 200; i++) {
      const [west, south, east, north] = here.bounds;
      controller.view({ ...here, bounds: [west + i * 1e-6, south, east + i * 1e-6, north] }, false);
    }

    expect(redraws()).toBe(asked);
  });

  it('asks once, not once per report, while a redraw is already on its way', () => {
    const { controller, ground, here, redraws } = setup();
    controller.fogFor(ground);

    for (let i = 0; i < 50; i++) controller.view(here, false);

    expect(redraws()).toBe(1);
  });

  it('asks again for a view that leaves what was drawn', () => {
    const { controller, ground, here, redraws } = setup();
    controller.fogFor(ground);
    controller.view(here, false);
    controller.fogFor(ground);
    const asked = redraws();

    controller.view(mapView(HERE.x + 40, HERE.y, HERE.x + 41, HERE.y), false);

    expect(redraws()).toBe(asked + 1);
  });

  it('draws with the latest view when the tiles change, whether or not a redraw was asked for', () => {
    const { controller, ground, here } = setup();
    controller.fogFor(ground);
    controller.view(here, false);
    const before = controller.fogFor(ground);

    const next = [...ground];
    const after = controller.fogFor(next);

    // Drawn afresh for the new tiles, and for the view the map last reported:
    // more than the blank fog it would show if it had forgotten where it was.
    expect(after).not.toBe(before);
    expect(after.geometry.coordinates.length).toBeGreaterThan(1);
    expect(controller.fogFor(next)).toBe(after);
  });

  it('ignores a report that is not a view', () => {
    const { controller, ground, redraws } = setup();
    controller.fogFor(ground);

    controller.view({ bounds: [1, 2, 3], zoom: 5 }, false);
    controller.view({ bounds: [1, 2, 3, 4], zoom: NaN }, true);

    expect(redraws()).toBe(0);
  });

  describe('while the map is moving', () => {
    it('asks for a redraw once the zoom crosses into a finer grain', () => {
      const { controller, ground, here, redraws } = setup();
      controller.fogFor(ground);
      controller.view({ ...here, zoom: 10 }, false);
      controller.fogFor(ground);
      const asked = redraws();

      controller.view({ ...here, zoom: 15 }, true);

      expect(redraws()).toBe(asked + 1);
    });

    it('asks no more often than the least gap, however fast the reports come', () => {
      const { controller, ground, here, redraws, advance } = setup();
      controller.fogFor(ground);
      controller.view({ ...here, zoom: 10 }, false);
      controller.fogFor(ground);
      const asked = redraws();

      controller.view({ ...here, zoom: 15 }, true);
      controller.fogFor(ground);
      controller.view({ ...here, zoom: 12 }, true);
      controller.view({ ...here, zoom: 11 }, true);

      expect(redraws()).toBe(asked + 1);

      advance(MOVING_REDRAW_GAP_MS);
      controller.view({ ...here, zoom: 11 }, true);

      expect(redraws()).toBe(asked + 2);
    });

    it('does not hold back the report that says the map has stopped', () => {
      const { controller, ground, here, redraws } = setup();
      controller.fogFor(ground);
      controller.view({ ...here, zoom: 10 }, false);
      controller.fogFor(ground);
      controller.view({ ...here, zoom: 15 }, true);
      controller.fogFor(ground);
      const asked = redraws();

      controller.view({ ...here, zoom: 11 }, false);

      expect(redraws()).toBe(asked + 1);
    });
  });
});
