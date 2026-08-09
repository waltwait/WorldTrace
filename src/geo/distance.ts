/** Great-circle distance on a spherical earth. */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Mean earth radius, IUGG. */
const EARTH_RADIUS_METERS = 6371008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Distance between two coordinates in metres.
 *
 * Haversine rather than Vincenty: at the distances that matter here — metres
 * between consecutive fixes, thousands of kilometres between flights — the
 * spherical error stays well inside GPS noise, and it has no iteration to
 * diverge.
 */
export function distanceMeters(from: LatLon, to: LatLon): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLon = toRadians(to.lon - from.lon);
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(fromLat) * Math.cos(toLat);

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}
