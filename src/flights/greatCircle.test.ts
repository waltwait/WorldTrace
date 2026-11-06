import { describe, expect, test } from 'vitest';
import {
  buildFlightArcsGeoJson,
  buildGreatCircleArc,
  calculateFlightMiles,
} from './greatCircle';

describe('greatCircle', () => {
  const TPE = { lat: 25.0797, lon: 121.2342 };
  const PVG = { lat: 31.1443, lon: 121.8083 };
  const NRT = { lat: 35.772, lon: 140.3929 };
  const LAX = { lat: 33.9416, lon: -118.4085 };

  describe('calculateFlightMiles', () => {
    test('calculates correct approximate distance between TPE and PVG', () => {
      const miles = calculateFlightMiles(TPE, PVG);
      // TPE to PVG is ~420 to 425 miles
      expect(miles).toBeGreaterThan(415);
      expect(miles).toBeLessThan(430);
    });

    test('calculates correct distance between TPE and NRT', () => {
      const miles = calculateFlightMiles(TPE, NRT);
      // TPE to NRT is ~1330 to 1360 miles
      expect(miles).toBeGreaterThan(1320);
      expect(miles).toBeLessThan(1370);
    });

    test('calculates long-haul transpacific distance (TPE to LAX)', () => {
      const miles = calculateFlightMiles(TPE, LAX);
      // TPE to LAX is ~6750 to 6850 miles
      expect(miles).toBeGreaterThan(6700);
      expect(miles).toBeLessThan(6900);
    });

    test('returns 0 for identical points', () => {
      expect(calculateFlightMiles(TPE, TPE)).toBe(0);
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
    test('builds GeoJSON FeatureCollection with LineString features', () => {
      const geojson = buildFlightArcsGeoJson([
        { depIata: 'TPE', arrIata: 'PVG' },
        { depIata: 'TPE', arrIata: 'NRT' },
      ]);

      expect(geojson.type).toBe('FeatureCollection');
      expect(geojson.features).toHaveLength(2);
      expect(geojson.features[0].geometry.type).toBe('LineString');
      expect(geojson.features[0].geometry.coordinates.length).toBeGreaterThan(10);
      expect(geojson.features[0].properties?.depIata).toBe('TPE');
      expect(geojson.features[0].properties?.arrIata).toBe('PVG');
    });

    test('safely skips unknown airport pairs', () => {
      const geojson = buildFlightArcsGeoJson([
        { depIata: 'UNKNOWN_A', arrIata: 'UNKNOWN_B' },
      ]);
      expect(geojson.features).toHaveLength(0);
    });
  });
});
