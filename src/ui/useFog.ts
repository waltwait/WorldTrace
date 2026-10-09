/**
 * The fog the map draws, built for the part of the world it is looking at.
 *
 * The map reports what it is showing and this keeps the fog to that: see
 * fog/fogGeometry.ts for why. Until the first report the whole world is fog,
 * which is wrong for a moment over ground already explored and never wrong the
 * other way.
 *
 * The fog is handed on as a string, serialised here once per change. The map's
 * source serialises any object it is given on every render, and a render
 * happens whenever the recorder's status or numbers move.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { createFogBuilder, type FogBuilder } from '../fog/fogGeometry';
import type { TileBitmap } from '../fog/geojson';
import { viewFromMap, type FogView } from '../fog/view';

export interface MapViewState {
  bounds: readonly number[];
  zoom: number;
}

export function useFog(tiles: TileBitmap[]): {
  fog: string;
  onMapView: (state: MapViewState) => void;
} {
  const builder = useRef<FogBuilder | null>(null);
  if (builder.current === null) builder.current = createFogBuilder();

  const [view, setView] = useState<FogView | null>(null);

  // The builder hands back the same object while its last build still serves,
  // so the string below is only made when the fog really changed.
  const feature = useMemo(() => builder.current!.build(tiles, view), [tiles, view]);
  const fog = useMemo(() => JSON.stringify(feature), [feature]);

  const onMapView = useCallback((state: MapViewState) => {
    const next = viewFromMap(state);
    if (next) setView(next);
  }, []);

  return { fog, onMapView };
}
