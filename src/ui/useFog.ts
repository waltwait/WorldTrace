/**
 * The fog the map draws, built for the part of the world it is looking at.
 *
 * The map reports what it is showing and this keeps the fog to that: see
 * fog/fogGeometry.ts for why. Until the first report the whole world is fog,
 * which is wrong for a moment over ground already explored and never wrong the
 * other way.
 *
 * The fog follows the map while it is still moving — the grain of the fog
 * follows the zoom, and zooming in on fog drawn for a wider view shows it blocky
 * until it is redrawn — but what to do about each report is decided in
 * fogController.ts, which leaves React alone unless the fog really is out of
 * date. The map reports on every frame even when it is sitting still, and a
 * render per report is a hundred renders a second.
 *
 * The fog is handed on as a string, serialised here once per change. The map's
 * source serialises any object it is given on every render, and a render
 * happens whenever the recorder's status or numbers move.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { TileBitmap } from '../fog/geojson';
import { createFogController, type FogController, type MapViewState } from './fogController';

export type { MapViewState };

export function useFog(tiles: TileBitmap[]): {
  fog: string;
  /** The map has settled, or has just loaded: draw for exactly this view. */
  onMapView: (state: MapViewState) => void;
  /** The map is moving: redraw if this view is no longer served. */
  onMapMoving: (state: MapViewState) => void;
} {
  const [, setDrawn] = useState(0);

  const controller = useRef<FogController | null>(null);
  if (controller.current === null) {
    controller.current = createFogController({
      requestRedraw: () => setDrawn((n) => n + 1),
      now: Date.now,
    });
  }

  // Cheap when nothing is out of date: the builder hands back what it has.
  const feature = controller.current.fogFor(tiles);
  const fog = useMemo(() => JSON.stringify(feature), [feature]);

  const onMapView = useCallback((state: MapViewState) => {
    controller.current!.view(state, false);
  }, []);

  const onMapMoving = useCallback((state: MapViewState) => {
    controller.current!.view(state, true);
  }, []);

  return { fog, onMapView, onMapMoving };
}
