import { describe, expect, test } from 'vitest';
import { projectFlightArcs, ringsPath } from './arcDiagram';
import type { FlightRecord } from './types';

function mockFlight(overrides: Partial<FlightRecord>): FlightRecord {
  return {
    id: 'f1',
    flightNumber: 'JX800',
    depDate: '2026-04-02',
    scheduleSource: 'api',
    airlineCode: 'JX',
    airlineName: 'Starlux Airlines',
    depIata: 'TPE',
    arrIata: 'NRT',
    depCountry: 'TW',
    arrCountry: 'JP',
    depLat: 25.0777,
    depLon: 121.2328,
    arrLat: 35.7647,
    arrLon: 140.3864,
    depScheduledUtc: Date.parse('2026-04-02T00:30:00Z'),
    arrScheduledUtc: Date.parse('2026-04-02T03:50:00Z'),
    depTz: 'Asia/Taipei',
    arrTz: 'Asia/Tokyo',
    status: 'LANDED',
    distanceKm: 2180,
    durationMinutes: 200,
    isFinished: true,
    createdAt: 0,
    ...overrides,
  };
}

describe('projectFlightArcs', () => {
  test('returns null when no flight has coordinates', () => {
    const manual = mockFlight({ depLat: null, depLon: null, arrLat: null, arrLon: null });

    expect(projectFlightArcs([manual], { width: 320, height: 186 })).toBeNull();
    expect(projectFlightArcs([], { width: 320, height: 186 })).toBeNull();
  });

  test('projects flight arcs, open-jaw ground transfer, graticule and non-overlapping IATA labels inside bounds', () => {
    const outbound = mockFlight({
      id: 'out',
      depIata: 'TPE',
      arrIata: 'NRT',
      depLat: 25.0777,
      depLon: 121.2328,
      arrLat: 35.7647,
      arrLon: 140.3864,
    });
    const inbound = mockFlight({
      id: 'in',
      flightNumber: 'JX823',
      depIata: 'KIX',
      arrIata: 'TPE',
      depLat: 34.4347,
      depLon: 135.244,
      arrLat: 25.0777,
      arrLon: 121.2328,
    });

    const layout = projectFlightArcs([outbound, inbound], { width: 320, height: 186 }, {
      connectGround: true,
      showLabels: true,
    });

    expect(layout).not.toBeNull();
    expect(layout!.arcs).toHaveLength(2);
    expect(layout!.groundLinks).toHaveLength(1);
    expect(layout!.airports.map((a) => a.iata).sort()).toEqual(['KIX', 'NRT', 'TPE']);
    expect(layout!.gridLines.length).toBeGreaterThan(2);

    for (const ap of layout!.airports) {
      expect(ap.x).toBeGreaterThan(8);
      expect(ap.x).toBeLessThan(312);
      expect(ap.y).toBeGreaterThan(8);
      expect(ap.y).toBeLessThan(178);
    }

    // All three stops of the trip fit without overlapping each other or stepping outside the panel.
    expect(layout!.labels.map((l) => l.iata).sort()).toEqual(['KIX', 'NRT', 'TPE']);
    for (let i = 0; i < layout!.labels.length; i++) {
      const a = layout!.labels[i];
      expect(a.x).toBeGreaterThanOrEqual(4);
      expect(a.x + a.width).toBeLessThanOrEqual(316);
      expect(a.y).toBeGreaterThanOrEqual(4);
      expect(a.y + a.height).toBeLessThanOrEqual(182);
      for (let j = i + 1; j < layout!.labels.length; j++) {
        const b = layout!.labels[j];
        const overlaps =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  test('keeps outbound and return trans-Pacific flights together across the International Date Line', () => {
    const out = mockFlight({
      id: 'out',
      depIata: 'TPE',
      arrIata: 'LAX',
      depLat: 25.0777,
      depLon: 121.2328,
      arrLat: 33.9416,
      arrLon: -118.4085,
    });
    const back = mockFlight({
      id: 'back',
      depIata: 'LAX',
      arrIata: 'TPE',
      depLat: 33.9416,
      depLon: -118.4085,
      arrLat: 25.0777,
      arrLon: 121.2328,
    });

    const layout = projectFlightArcs([out, back], { width: 320, height: 186 });

    expect(layout).not.toBeNull();
    const tpe = layout!.airports.find((a) => a.iata === 'TPE')!;
    const lax = layout!.airports.find((a) => a.iata === 'LAX')!;
    // Across the Pacific, Taipei sits on the left (west of the date line) and LA on the right.
    expect(tpe.x).toBeLessThan(lax.x);
    expect(lax.x - tpe.x).toBeGreaterThan(120);
  });

  test('omits IATA text labels when showLabels is false (for dense multi-trip year maps)', () => {
    const layout = projectFlightArcs([mockFlight({})], { width: 130, height: 134 }, {
      showLabels: false,
    });

    expect(layout).not.toBeNull();
    expect(layout!.labels).toEqual([]);
  });
});

describe('land under the arcs', () => {
  const size = { width: 320, height: 186 };
  const japan = [
    mockFlight({ id: 'a' }),
    mockFlight({
      id: 'b',
      depIata: 'KIX',
      arrIata: 'TPE',
      depLat: 34.4347,
      depLon: 135.244,
      arrLat: 25.0777,
      arrLon: 121.2328,
    }),
  ];

  const around = (ring: ReadonlyArray<readonly [number, number]>, x: number, y: number) => {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return Math.min(...xs) <= x && x <= Math.max(...xs) && Math.min(...ys) <= y && y <= Math.max(...ys);
  };

  test('puts each airport on its land', () => {
    const layout = projectFlightArcs(japan, size)!;

    for (const airport of layout.airports) {
      expect(layout.land.some((ring) => around(ring, airport.x, airport.y)), airport.iata).toBe(true);
    }
  });

  test('draws only the land the panel shows', () => {
    const layout = projectFlightArcs(japan, size)!;

    expect(layout.land.length).toBeGreaterThan(0);
    for (const ring of layout.land) {
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      expect(Math.max(...xs) >= 0 && Math.min(...xs) <= size.width).toBe(true);
      expect(Math.max(...ys) >= 0 && Math.min(...ys) <= size.height).toBe(true);
    }
  });

  // Over the Pacific the arcs run past 180°: America has to be drawn on the same side.
  test('finds the land across the date line', () => {
    const pacific = [
      mockFlight({ arrIata: 'LAX', arrCountry: 'US', arrLat: 33.9425, arrLon: -118.408 }),
    ];
    const layout = projectFlightArcs(pacific, size)!;

    for (const airport of layout.airports) {
      expect(layout.land.some((ring) => around(ring, airport.x, airport.y)), airport.iata).toBe(true);
    }
  });

  test('is one path of closed rings', () => {
    expect(ringsPath([[[0, 0], [10, 0], [10, 10]]])).toBe('M0.0 0.0L10.0 0.0L10.0 10.0Z');
    expect(ringsPath([])).toBe('');
  });
});
