import { describe, expect, test } from 'vitest';
import {
  routesKey,
  buildFlightArcsGeoJson,
  buildGreatCircleArc,
  calculateFlightKm,
  flightEnds,
} from './greatCircle';

describe('greatCircle', () => {
  const TPE = { lat: 25.0797, lon: 121.2342 };
  const PVG = { lat: 31.1443, lon: 121.8083 };
  const NRT = { lat: 35.772, lon: 140.3929 };
  const LAX = { lat: 33.9416, lon: -118.4085 };

  describe('calculateFlightKm', () => {
    test('TPE to PVG is about 680 km', () => {
      const km = calculateFlightKm(TPE, PVG);
      expect(km).toBeGreaterThan(660);
      expect(km).toBeLessThan(700);
    });

    test('TPE to LAX is about 10,900 km', () => {
      const km = calculateFlightKm(TPE, LAX);
      expect(km).toBeGreaterThan(10800);
      expect(km).toBeLessThan(11100);
    });

    test('returns 0 for identical points', () => {
      expect(calculateFlightKm(TPE, TPE)).toBe(0);
    });
  });

  describe('buildGreatCircleArc', () => {
    test('produces the requested number of points starting at from and ending at to', () => {
      const points = buildGreatCircleArc(TPE, PVG, 30);
      expect(points).toHaveLength(30);

      // GeoJSON coordinate order: [lon, lat]
      expect(points[0][0]).toBeCloseTo(TPE.lon, 2);
      expect(points[0][1]).toBeCloseTo(TPE.lat, 2);

      expect(points[points.length - 1][0]).toBeCloseTo(PVG.lon, 2);
      expect(points[points.length - 1][1]).toBeCloseTo(PVG.lat, 2);
    });

    test('returns single point when from and to are identical', () => {
      const points = buildGreatCircleArc(TPE, TPE, 10);
      expect(points).toHaveLength(1);
      expect(points[0]).toEqual([TPE.lon, TPE.lat]);
    });
  });

  describe('buildFlightArcsGeoJson', () => {
    const route = (depIata: string, arrIata: string, from: typeof TPE, to: typeof TPE) => ({
      depIata,
      arrIata,
      depLat: from.lat,
      depLon: from.lon,
      arrLat: to.lat,
      arrLon: to.lon,
    });

    test('builds GeoJSON FeatureCollection with LineString features', () => {
      const geojson = buildFlightArcsGeoJson([
        route('TPE', 'PVG', TPE, PVG),
        route('TPE', 'NRT', TPE, NRT),
      ]);

      expect(geojson.type).toBe('FeatureCollection');
      expect(geojson.features).toHaveLength(2);
      expect(geojson.features[0].geometry.type).toBe('LineString');
      expect(geojson.features[0].geometry.coordinates.length).toBeGreaterThan(10);
      expect(geojson.features[0].properties?.depIata).toBe('TPE');
      expect(geojson.features[0].properties?.arrIata).toBe('PVG');
    });

    test('leaves out a flight with no positions', () => {
      const geojson = buildFlightArcsGeoJson([{ depIata: 'TPE', arrIata: 'NRT', depLat: null }]);
      expect(geojson.features).toHaveLength(0);
    });
  });

  describe('flightEnds', () => {
    test('gives both ends of a flight', () => {
      expect(
        flightEnds({ depLat: 1, depLon: 2, arrLat: 3, arrLon: 4 }),
      ).toEqual({ dep: { lat: 1, lon: 2 }, arr: { lat: 3, lon: 4 } });
    });

    // Zero is a place: the equator, or Greenwich.
    test('takes a coordinate of zero as a coordinate', () => {
      expect(flightEnds({ depLat: 0, depLon: 0, arrLat: 0, arrLon: 1 })).not.toBeNull();
    });

    test('gives nothing if any is missing', () => {
      expect(flightEnds({ depLat: 1, depLon: 2, arrLat: 3, arrLon: null })).toBeNull();
    });
  });
});

describe('arcs over the date line', () => {
  test('a trans-Pacific arc never jumps across the map between two points', () => {
    const tpe = { lat: 25.0797, lon: 121.2342 };
    const lax = { lat: 33.9416, lon: -118.4085 };
    const arc = buildGreatCircleArc(tpe, lax, 40);
    for (let i = 1; i < arc.length; i++) {
      expect(Math.abs(arc[i][0] - arc[i - 1][0])).toBeLessThan(180);
    }
    // It goes east over the Pacific: past 180 rather than back across Asia.
    expect(arc[arc.length - 1][0]).toBeCloseTo(lax.lon + 360, 6);
    expect(arc[arc.length - 1][1]).toBeCloseTo(lax.lat, 6);
  });
});

describe('routesKey', () => {
  const a = { id: 'a', depIata: 'TPE', arrIata: 'NRT' };
  const b = { id: 'b', depIata: 'TPE', arrIata: 'LAX' };

  test('changes when a route is added, removed or changed', () => {
    const base = routesKey([a, b]);
    expect(routesKey([a])).not.toBe(base);
    expect(routesKey([a, b, { id: 'c', depIata: 'NRT', arrIata: 'TPE' }])).not.toBe(base);
    expect(routesKey([a, { ...b, arrIata: 'SFO' }])).not.toBe(base);
  });

  test('stays the same for the same routes, whatever else about the flights changed', () => {
    expect(routesKey([{ ...a, depGate: 'B7' } as typeof a, b])).toBe(routesKey([a, b]));
  });
});
