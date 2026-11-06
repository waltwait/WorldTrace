/**
 * Where to point the camera to show one route, worked out here rather than by
 * the map's fitBounds.
 *
 * The map was given the smallest and largest longitude of the two airports.
 * For TPE→LAX that is a box from 118°W to 121°E — the long way round, centred
 * on Africa. A box that crosses the date line has to say so, and how the
 * native Android bounds type takes that cannot be checked from here; a centre
 * and a zoom are unambiguous. The route's arc comes unwrapped (see
 * buildGreatCircleArc), so its extent is the short way round.
 */

export interface RouteCamera {
  /** [lon, lat], longitude within [-180, 180). */
  center: [number, number];
  zoom: number;
}

interface Size {
  width: number;
  height: number;
}

interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// MapLibre's zoom 0 is one 512-point tile for the whole world.
const TILE = 512;
const MAX_ZOOM = 12;

const mercatorX = (lon: number) => (lon + 180) / 360;
const mercatorY = (lat: number) =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const latFromMercatorY = (y: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

export function routeCamera(
  route: Array<[number, number]>,
  view: Size,
  padding: Padding,
): RouteCamera {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [lon, lat] of route) {
    const x = mercatorX(lon);
    const y = mercatorY(lat);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const width = Math.max(1, view.width - padding.left - padding.right);
  const height = Math.max(1, view.height - padding.top - padding.bottom);
  const fitX = maxX > minX ? Math.log2(width / ((maxX - minX) * TILE)) : MAX_ZOOM;
  const fitY = maxY > minY ? Math.log2(height / ((maxY - minY) * TILE)) : MAX_ZOOM;
  const zoom = Math.max(0, Math.min(MAX_ZOOM, fitX, fitY));

  const lon = ((((minX + maxX) / 2) * 360) % 360 + 360) % 360 - 180;
  const lat = latFromMercatorY((minY + maxY) / 2);
  return { center: [lon, lat], zoom };
}
