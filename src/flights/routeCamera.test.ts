import { describe, expect, test } from 'vitest';
import { buildGreatCircleArc } from './greatCircle';
import { routeCamera } from './routeCamera';

const VIEW = { width: 400, height: 800 };
const PADDING = { top: 120, bottom: 140, left: 60, right: 60 };

const AIRPORTS: Record<string, { lat: number; lon: number }> = {
  TPE: { lat: 25.0797, lon: 121.2342 },
  NRT: { lat: 35.772, lon: 140.3929 },
  LAX: { lat: 33.9416, lon: -118.4085 },
  JFK: { lat: 40.6413, lon: -73.7781 },
  LHR: { lat: 51.47, lon: -0.4543 },
  SYD: { lat: -33.9399, lon: 151.1753 },
  HND: { lat: 35.5494, lon: 139.7798 },
  PVG: { lat: 31.1443, lon: 121.8083 },
};

function arc(from: string, to: string) {
  return buildGreatCircleArc(AIRPORTS[from], AIRPORTS[to], 40);
}

describe('routeCamera', () => {
  test('frames a trans-Pacific route over the Pacific, not over Africa', () => {
    const { center, zoom } = routeCamera(arc('TPE', 'LAX'), VIEW, PADDING);
    // Halfway between 121°E and 118°W, the short way, is near the date line.
    expect(Math.abs(center[0])).toBeGreaterThan(150);
    expect(center[0]).toBeGreaterThanOrEqual(-180);
    expect(center[0]).toBeLessThan(180);
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThan(3);
  });

  test('frames a short route between its ends, closer in', () => {
    const tpeNrt = routeCamera(arc('TPE', 'NRT'), VIEW, PADDING);
    expect(tpeNrt.center[0]).toBeGreaterThan(121);
    expect(tpeNrt.center[0]).toBeLessThan(141);
    expect(tpeNrt.zoom).toBeGreaterThan(routeCamera(arc('TPE', 'LAX'), VIEW, PADDING).zoom);
  });

  test('the whole route fits inside the padded view', () => {
    const route = arc('TPE', 'LAX');
    const { center, zoom } = routeCamera(route, VIEW, PADDING);
    const world = 512 * 2 ** zoom;
    const x = (lon: number) => ((lon + 180) / 360) * world;
    const y = (lat: number) =>
      ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * world;
    // Unwrap the centre next to the route before measuring.
    let cLon = center[0];
    while (cLon < route[0][0] - 180) cLon += 360;
    const halfW = (VIEW.width - PADDING.left - PADDING.right) / 2;
    const halfH = (VIEW.height - PADDING.top - PADDING.bottom) / 2;
    for (const [lon, lat] of route) {
      expect(Math.abs(x(lon) - x(cLon))).toBeLessThanOrEqual(halfW + 0.5);
      expect(Math.abs(y(lat) - y(center[1]))).toBeLessThanOrEqual(halfH + 0.5);
    }
    // And sits in the middle of it, on both axes.
    const dx = route.map(([lon]) => x(lon) - x(cLon));
    const dy = route.map(([, lat]) => y(lat) - y(center[1]));
    expect(Math.max(...dx) + Math.min(...dx)).toBeCloseTo(0, 3);
    expect(Math.max(...dy) + Math.min(...dy)).toBeCloseTo(0, 3);
  });
});
