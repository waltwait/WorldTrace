import { describe, expect, test } from 'vitest';
import {
  airportCity,
  computePassportStats,
  countryStamps,
  flightsInYear,
  flownYears,
  longestFlight,
  rankAirlines,
  rankRoutes,
  timesAroundEarth,
} from './flightStats';
import type { FlightRecord } from './types';

function createMockFlight(overrides: Partial<FlightRecord>): FlightRecord {
  return {
    id: 'f-1',
    flightNumber: 'CI501',
    depDate: '2026-12-31',
    scheduleSource: 'api',
    airlineCode: 'CI',
    airlineName: 'China Airlines',
    depIata: 'TPE',
    arrIata: 'PVG',
    depScheduledUtc: 1767141900000,
    arrScheduledUtc: 1767149400000,
    depTz: 'Asia/Taipei',
    arrTz: 'Asia/Shanghai',
    status: 'LANDED',
    distanceKm: 420,
    durationMinutes: 125,
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
    expect(stats.totalKm).toBe(0);
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
      depCountry: 'TW',
      arrCountry: 'CN',
      distanceKm: 420,
      durationMinutes: 120, // 2.0 hrs
    });
    const f2 = createMockFlight({
      id: 'f-2',
      depIata: 'TPE',
      arrIata: 'NRT',
      depCountry: 'TW',
      arrCountry: 'JP',
      distanceKm: 1356,
      durationMinutes: 195, // 3.25 hrs -> total 5.25 -> 5.3 hrs
    });
    const f3 = createMockFlight({
      id: 'f-3',
      depIata: 'NRT',
      arrIata: 'TPE',
      depCountry: 'JP',
      arrCountry: 'TW',
      distanceKm: 1356,
      durationMinutes: 210, // 3.5 hrs -> total 8.75 -> 8.8 hrs
    });

    const stats = computePassportStats([f1, f2, f3]);
    expect(stats.totalFlights).toBe(3);
    expect(stats.totalKm).toBe(420 + 1356 + 1356); // 3132
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
      distanceKm: 500,
      durationMinutes: 60,
    });
    const booked = createMockFlight({
      id: 'f-2',
      isFinished: false,
      arrIata: 'LHR',
      distanceKm: 6000,
      durationMinutes: 800,
    });

    const stats = computePassportStats([flown, booked]);
    expect(stats.totalFlights).toBe(1);
    expect(stats.totalKm).toBe(500);
    expect(stats.totalHours).toBe(1.0);
    expect(stats.visitedCountryCodes).not.toContain('GB');
  });
});

// Marking it finished, by hand or by mistake, does not mean it was flown.
test('a cancelled flight is not a flight flown, finished or not', () => {
  const cancelled = createMockFlight({ status: 'CANCELLED', isFinished: true });

  expect(computePassportStats([cancelled]).totalFlights).toBe(0);
  expect(computePassportStats([cancelled]).visitedCountriesCount).toBe(0);
  expect(rankAirlines([cancelled])).toEqual([]);
});

// Typed in by hand, a flight has neither: it still counts, without inventing them.
test('a flight with no country or distance counts as a flight and adds no stamp', () => {
  const stats = computePassportStats([
    createMockFlight({ depCountry: null, arrCountry: null, distanceKm: null }),
  ]);

  expect(stats.totalFlights).toBe(1);
  expect(stats.totalKm).toBe(0);
  expect(stats.visitedCountryCodes).toEqual([]);
});

describe('the years of a passport', () => {
  const flights = [
    createMockFlight({ id: 'a', depDate: '2025-03-01' }),
    createMockFlight({ id: 'b', depDate: '2027-01-02' }),
    createMockFlight({ id: 'c', depDate: '2025-08-09' }),
    createMockFlight({ id: 'd', depDate: '2028-01-01', isFinished: false }),
  ];

  test('are those flown in, newest first, once each', () => {
    expect(flownYears(flights)).toEqual(['2027', '2025']);
  });

  test('narrow the flights to one', () => {
    expect(flightsInYear(flights, '2025').map((f) => f.id)).toEqual(['a', 'c']);
  });

  test('take every flight when no year is chosen', () => {
    expect(flightsInYear(flights, null)).toBe(flights);
  });

  // Taken from the departure date, which is on the airport's clocks: a flight
  // leaving Taipei at 07:00 on New Year's Day is still 2026 in UTC.
  test('go by the date on the ticket, not by UTC', () => {
    const newYear = createMockFlight({
      depDate: '2027-01-01',
      depScheduledUtc: Date.UTC(2026, 11, 31, 23, 0),
    });

    expect(flownYears([newYear])).toEqual(['2027']);
  });
});

describe('countryStamps', () => {
  const tokyo = createMockFlight({
    id: 'out',
    depCountry: 'TW',
    arrCountry: 'JP',
    depDate: '2026-03-01',
  });
  const home = createMockFlight({
    id: 'back',
    depCountry: 'JP',
    arrCountry: 'TW',
    depDate: '2026-03-08',
  });
  const singapore = createMockFlight({
    id: 'sg',
    depCountry: 'TW',
    arrCountry: 'SG',
    depDate: '2025-06-01',
  });

  test('gives each country the flights that touched it, the most first', () => {
    const stamps = countryStamps([singapore, tokyo, home]);

    expect(stamps.map((s) => s.code)).toEqual(['TW', 'JP', 'SG']);
    expect(stamps[1].flights.map((f) => f.id)).toEqual(['back', 'out']);
  });

  test('lists a country\'s flights newest first', () => {
    expect(countryStamps([tokyo, home])[0].flights.map((f) => f.id)).toEqual(['back', 'out']);
  });

  test('counts a domestic flight once', () => {
    const domestic = createMockFlight({ depCountry: 'JP', arrCountry: 'JP' });

    expect(countryStamps([domestic])[0].flights).toHaveLength(1);
  });

  test('says when the country was first reached', () => {
    expect(countryStamps([singapore, tokyo, home])[0].firstDate).toBe('2025-06-01');
  });

  test('has no stamp for a flight nobody flew', () => {
    expect(countryStamps([{ ...tokyo, isFinished: false }])).toEqual([]);
  });

  test('has no stamp for a country nobody named', () => {
    expect(countryStamps([createMockFlight({ depCountry: null, arrCountry: null })])).toEqual([]);
  });
});

describe('rankAirlines', () => {
  test('puts the one flown most first, not the one booked most', () => {
    const flights = [
      createMockFlight({ id: 'a', airlineName: 'EVA Air' }),
      createMockFlight({ id: 'b', airlineName: 'Starlux', isFinished: false }),
      createMockFlight({ id: 'c', airlineName: 'Starlux', isFinished: false }),
    ];

    expect(rankAirlines(flights)).toEqual([{ name: 'EVA Air', count: 1 }]);
  });

  test('falls back on the code when there is no name', () => {
    expect(rankAirlines([createMockFlight({ airlineName: '', airlineCode: 'BR' })])).toEqual([
      { name: 'BR', count: 1 },
    ]);
  });
});

describe('rankRoutes', () => {
  // There and back is one route flown twice, not two routes flown once.
  test('counts a route the same in both directions', () => {
    const flights = [
      createMockFlight({ id: 'a', depIata: 'TPE', arrIata: 'NRT' }),
      createMockFlight({ id: 'b', depIata: 'NRT', arrIata: 'TPE' }),
      createMockFlight({ id: 'c', depIata: 'TPE', arrIata: 'SIN' }),
    ];

    expect(rankRoutes(flights)).toEqual([
      { from: 'NRT', to: 'TPE', count: 2 },
      { from: 'SIN', to: 'TPE', count: 1 },
    ]);
  });
});

describe('longestFlight', () => {
  test('is the one that went furthest', () => {
    const flights = [
      createMockFlight({ id: 'near', distanceKm: 640 }),
      createMockFlight({ id: 'far', distanceKm: 9_800 }),
    ];

    expect(longestFlight(flights)?.id).toBe('far');
  });

  test('passes over a distance nobody knows', () => {
    expect(longestFlight([createMockFlight({ distanceKm: null })])).toBeNull();
  });

  test('passes over a flight nobody flew', () => {
    expect(longestFlight([createMockFlight({ isFinished: false })])).toBeNull();
  });
});

describe('airportCity', () => {
  const flights = [createMockFlight({ depIata: 'TPE', depCity: 'Taipei', arrIata: 'NRT', arrCity: 'Tokyo' })];

  test('comes from a flight that used the airport, at either end', () => {
    expect(airportCity(flights, 'TPE')).toBe('Taipei');
    expect(airportCity(flights, 'NRT')).toBe('Tokyo');
  });

  test('is unknown when no flight says', () => {
    expect(airportCity(flights, 'SIN')).toBeNull();
  });
});

describe('timesAroundEarth', () => {
  test('measures the distance against the equator', () => {
    expect(timesAroundEarth(40_075)).toBeCloseTo(1);
    expect(timesAroundEarth(100_187.5)).toBeCloseTo(2.5);
  });
});
