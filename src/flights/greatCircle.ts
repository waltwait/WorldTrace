/**
 * Great Circle distance and spherical arc geometry calculations.
 */

import { findAirport } from './airports';

const EARTH_RADIUS_MILES = 3958.7613;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Calculates Great Circle flight distance in miles using the Haversine formula.
 */
export function calculateFlightMiles(
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
  return Math.round(EARTH_RADIUS_MILES * c * 10) / 10;
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

/**
 * Converts a list of flights into a GeoJSON FeatureCollection of Great Circle LineStrings.
 */
export function buildFlightArcsGeoJson(
  flights: Array<{
    depIata: string;
    arrIata: string;
    airlineCode?: string;
    flightNumber?: string;
  }>,
  numPointsPerArc = 40,
): FlightArcsFeatureCollection {
  const features: FlightArcsFeatureCollection['features'] = [];

  for (const flight of flights) {
    const dep = findAirport(flight.depIata);
    const arr = findAirport(flight.arrIata);

    if (!dep || !arr) continue;

    const coordinates = buildGreatCircleArc(
      { lat: dep.lat, lon: dep.lon },
      { lat: arr.lat, lon: arr.lon },
      numPointsPerArc,
    );

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
