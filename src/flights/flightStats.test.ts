import { describe, expect, test } from 'vitest';
import { computePassportStats, topAirline } from './flightStats';
import type { FlightRecord } from './types';

function createMockFlight(overrides: Partial<FlightRecord>): FlightRecord {
  return {
    id: 'f-1',
    flightNumber: 'CI501',
    airlineCode: 'CI',
    airlineName: 'China Airlines',
    depIata: 'TPE',
    arrIata: 'PVG',
    depScheduledUtc: 1767141900000,
    arrScheduledUtc: 1767149400000,
    depTz: 'Asia/Taipei',
    arrTz: 'Asia/Shanghai',
    status: 'LANDED',
    distanceMiles: 420,
    durationMinutes: 125,
    notificationsEnabled: false,
    isFinished: true,
    createdAt: 1766900000000,
    ...overrides,
  };
}

describe('flightStats', () => {
  test('computes zero stats when flight list is empty', () => {
    const stats = computePassportStats([]);
    expect(stats.totalFlights).toBe(0);
    expect(stats.totalHours).toBe(0);
    expect(stats.totalMiles).toBe(0);
    expect(stats.visitedCountriesCount).toBe(0);
    expect(stats.visitedCountryCodes).toEqual([]);
    expect(stats.topAirportIata).toBeNull();
    expect(stats.airportVisits).toEqual([]);
  });

  test('aggregates stats correctly for single and multiple flights', () => {
    const f1 = createMockFlight({
      id: 'f-1',
      depIata: 'TPE',
      arrIata: 'PVG',
      distanceMiles: 420,
      durationMinutes: 120, // 2.0 hrs
    });
    const f2 = createMockFlight({
      id: 'f-2',
      depIata: 'TPE',
      arrIata: 'NRT',
      distanceMiles: 1356,
      durationMinutes: 195, // 3.25 hrs -> total 5.25 -> 5.3 hrs
    });
    const f3 = createMockFlight({
      id: 'f-3',
      depIata: 'NRT',
      arrIata: 'TPE',
      distanceMiles: 1356,
      durationMinutes: 210, // 3.5 hrs -> total 8.75 -> 8.8 hrs
    });

    const stats = computePassportStats([f1, f2, f3]);
    expect(stats.totalFlights).toBe(3);
    expect(stats.totalMiles).toBe(420 + 1356 + 1356); // 3132
    expect(stats.totalHours).toBe(8.8); // (120 + 195 + 210) / 60 = 525 / 60 = 8.75 -> 8.8

    // TPE (TW), PVG (CN), NRT (JP) -> 3 countries: TW, CN, JP
    expect(stats.visitedCountriesCount).toBe(3);
    expect(stats.visitedCountryCodes).toEqual(expect.arrayContaining(['TW', 'CN', 'JP']));

    // TPE appears 3 times (f1 dep, f2 dep, f3 arr)
    // NRT appears 2 times (f2 arr, f3 dep)
    // PVG appears 1 time (f1 arr)
    expect(stats.topAirportIata).toBe('TPE');
    expect(stats.airportVisits[0]).toEqual({ iata: 'TPE', count: 3 });
    expect(stats.airportVisits[1]).toEqual({ iata: 'NRT', count: 2 });
    expect(stats.airportVisits[2]).toEqual({ iata: 'PVG', count: 1 });
  });

  test('counts only flights already flown: a booked trip earns no hours, miles or stamp', () => {
    const flown = createMockFlight({
      id: 'f-1',
      isFinished: true,
      distanceMiles: 500,
      durationMinutes: 60,
    });
    const booked = createMockFlight({
      id: 'f-2',
      isFinished: false,
      arrIata: 'LHR',
      distanceMiles: 6000,
      durationMinutes: 800,
    });

    const stats = computePassportStats([flown, booked]);
    expect(stats.totalFlights).toBe(1);
    expect(stats.totalMiles).toBe(500);
    expect(stats.totalHours).toBe(1.0);
    expect(stats.visitedCountryCodes).not.toContain('GB');
  });

  test('the top airline is the one flown most, not the one booked most', () => {
    const flights = [
      createMockFlight({ id: 'a', airlineName: 'EVA Air', isFinished: true }),
      createMockFlight({ id: 'b', airlineName: 'Starlux', isFinished: false }),
      createMockFlight({ id: 'c', airlineName: 'Starlux', isFinished: false }),
    ];
    expect(topAirline(flights)).toEqual({ name: 'EVA Air', count: 1 });
    expect(topAirline([flights[1]])).toBeNull();
  });
});
