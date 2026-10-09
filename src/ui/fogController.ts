/**
 * Deciding when the fog has to be drawn again, apart from React.
 *
 * The map reports where it is on every frame it moves — and, in the mode that
 * follows the user's position, on every frame it sits still: about 120 times a
 * second on a fast screen. Each report used to be put into React state as a new
 * object, so a map doing nothing rendered its whole screen a hundred times a
 * second. A report is only worth acting on if the fog already drawn no longer
 * serves it, which is a question the fog builder can answer in microseconds, so
 * that is asked first and React is left alone when the answer is no.
 *
 * Kept as plain code with its clock handed in so that this decision, which was
 * wrong once without anything failing, can be tested.
 */

import { createFogBuilder, type FogBuilder } from '../fog/fogGeometry';
import type { MultiPolygonFeature, TileBitmap } from '../fog/geojson';
import { viewFromMap } from '../fog/view';
import type { FogView } from '../fog/view';

/** Least time between redraws asked for by a map that is still moving. */
export const MOVING_REDRAW_GAP_MS = 250;

export interface MapViewState {
  bounds: readonly number[];
  zoom: number;
}

export interface FogController {
  /**
   * The map says where it is. `moving` is true while it is still in motion;
   * those reports are the ones that arrive in floods, and are held to a gap.
   */
  view(state: MapViewState | null | undefined, moving: boolean): void;
  /** The fog to draw for these tiles and the view the map last reported. */
  fogFor(tiles: TileBitmap[]): MultiPolygonFeature;
}

export function createFogController(deps: {
  /** The fog is out of date: draw the screen again, which will call fogFor. */
  requestRedraw(): void;
  now(): number;
  builder?: FogBuilder;
}): FogController {
  const builder = deps.builder ?? createFogBuilder();

  let latest: FogView | null = null;
  let tiles: TileBitmap[] = [];
  let redrawOnItsWay = false;
  let lastMovingRequest = -Infinity;

  return {
    view(state, moving) {
      const next = viewFromMap(state);
      if (!next) return;

      // Remembered even when nothing is asked for, so that whatever draws next
      // — new tiles, say — draws for where the map is now.
      latest = next;

      if (redrawOnItsWay || builder.isCurrent(tiles, next)) return;

      if (moving) {
        const at = deps.now();
        if (at - lastMovingRequest < MOVING_REDRAW_GAP_MS) return;
        lastMovingRequest = at;
      }

      redrawOnItsWay = true;
      deps.requestRedraw();
    },

    fogFor(nextTiles) {
      tiles = nextTiles;
      redrawOnItsWay = false;
      return builder.build(nextTiles, latest);
    },
  };
}
