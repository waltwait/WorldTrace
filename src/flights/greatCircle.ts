/**
 * Great Circle distance and spherical arc geometry calculations.
 */

const EARTH_RADIUS_KM = 6371.0088;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Calculates Great Circle flight distance in kilometres using the Haversine formula.
 */
export function calculateFlightKm(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): number {
  if (from.lat === to.lat && from.lon === to.lon) {
    return 0;
  }

  const dLat = toRadians(to.lat - from.lat);
  const dLon = toRadians(to.lon - from.lon);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return Math.round(EARTH_RADIUS_KM * c * 10) / 10;
}

type Vector3 = [number, number, number];

function latLonToVector(lat: number, lon: number): Vector3 {
  const phi = toRadians(lat);
  const lambda = toRadians(lon);
  return [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];
}

function vectorToLatLon(v: Vector3): [number, number] {
  const [x, y, z] = v;
  const lat = toDegrees(Math.asin(Math.max(-1, Math.min(1, z))));
  const lon = toDegrees(Math.atan2(y, x));
  return [lon, lat];
}

/**
 * Builds a smooth Great Circle Arc between two coordinates using spherical interpolation (Slerp).
 * Returns array of [lon, lat] GeoJSON coordinates.
 */
export function buildGreatCircleArc(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  numPoints = 50,
): Array<[number, number]> {
  if (from.lat === to.lat && from.lon === to.lon) {
    return [[from.lon, from.lat]];
  }

  const n = Math.max(2, numPoints);
  const v1 = latLonToVector(from.lat, from.lon);
  const v2 = latLonToVector(to.lat, to.lon);

  const dot = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));

  // If points are antipodal or identical
  if (dot > 0.999999) {
    return [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ];
  }

  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);

  const coords: Array<[number, number]> = [];

  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const w1 = Math.sin((1 - f) * omega) / sinOmega;
    const w2 = Math.sin(f * omega) / sinOmega;

    const interpolated: Vector3 = [
      w1 * v1[0] + w2 * v2[0],
      w1 * v1[1] + w2 * v2[1],
      w1 * v1[2] + w2 * v2[2],
    ];

    coords.push(vectorToLatLon(interpolated));
  }

  // atan2 gives longitudes in [-180, 180], so an arc over the Pacific jumps
  // from 180 to -180 halfway and the map joins the two with a line across
  // the whole world. Keep each point within 180° of the one before; a line
  // past 180 is how MapLibre is told to cross the date line.
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1][0];
    let lon = coords[i][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    coords[i][0] = lon;
  }

  return coords;
}

export interface FlightArcFeatureProperties {
  depIata: string;
  arrIata: string;
  airlineCode?: string;
  flightNumber?: string;
}

export interface FlightArcsFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: FlightArcFeatureProperties;
    geometry: {
      type: 'LineString';
      coordinates: Array<[number, number]>;
    };
  }>;
}

type Positioned = {
  depLat?: number | null;
  depLon?: number | null;
  arrLat?: number | null;
  arrLon?: number | null;
};

/** Both ends of a flight, or null for one typed in with no positions. */
export function flightEnds(
  flight: Positioned,
): { dep: { lat: number; lon: number }; arr: { lat: number; lon: number } } | null {
  const { depLat, depLon, arrLat, arrLon } = flight;
  if (depLat == null || depLon == null || arrLat == null || arrLon == null) return null;
  return { dep: { lat: depLat, lon: depLon }, arr: { lat: arrLat, lon: arrLon } };
}

/**
 * Converts a list of flights into a GeoJSON FeatureCollection of Great Circle LineStrings.
 */
export function buildFlightArcsGeoJson(
  flights: Array<
    Positioned & {
      depIata: string;
      arrIata: string;
      airlineCode?: string;
      flightNumber?: string;
    }
  >,
  numPointsPerArc = 40,
): FlightArcsFeatureCollection {
  const features: FlightArcsFeatureCollection['features'] = [];

  for (const flight of flights) {
    const ends = flightEnds(flight);
    if (!ends) continue;

    const coordinates = buildGreatCircleArc(ends.dep, ends.arr, numPointsPerArc);

    features.push({
      type: 'Feature',
      properties: {
        depIata: flight.depIata,
        arrIata: flight.arrIata,
        airlineCode: flight.airlineCode,
        flightNumber: flight.flightNumber,
      },
      geometry: {
        type: 'LineString',
        coordinates,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * What the drawn arcs depend on, as one string. The map re-reads flights
 * each time it comes into view, and handing MapLibre a new source makes it
 * throw its tiles away and start again — so the arcs are rebuilt only when
 * this changes, not when a gate or a status does.
 */
export function routesKey(
  flights: ReadonlyArray<{ id: string; depIata: string; arrIata: string }>,
): string {
  return flights.map((f) => `${f.id}:${f.depIata}-${f.arrIata}`).join(',');
}
