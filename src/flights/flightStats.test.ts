import { describe, expect, test } from 'vitest';
import {
  airportCity,
  computePassportStats,
  countryStamps,
  flightsInYear,
  flownYears,
  journeysOf,
  knownCountries,
  longestFlight,
  rankAirlines,
  rankRoutes,
  tripsOf,
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

    // Two trips: f1 alone, and f2 out and f3 back. TPE was used by both.
    expect(stats.topAirportIata).toBe('TPE');
    expect(stats.airportVisits[0]).toEqual({ iata: 'TPE', count: 2 });
    expect(stats.airportVisits[1]).toEqual({ iata: 'NRT', count: 1 });
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

  test('are those flown in, in order, once each', () => {
    expect(flownYears(flights)).toEqual(['2025', '2027']);
  });

  test('go in order however the flights were added', () => {
    expect(flownYears([flights[1], flights[0]])).toEqual(['2025', '2027']);
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

  // Looked up it is EVA Air; with no name from the API, BR; typed in, whatever was typed.
  test('counts an airline once, whatever each flight called it', () => {
    const flights = [
      createMockFlight({ id: 'a', airlineCode: 'BR', airlineName: 'EVA Air' }),
      createMockFlight({ id: 'b', airlineCode: 'BR', airlineName: 'EVA Air' }),
      createMockFlight({ id: 'c', airlineCode: 'BR', airlineName: 'BR' }),
      createMockFlight({ id: 'd', airlineCode: 'BR', airlineName: '長榮航空', scheduleSource: 'user' }),
    ];

    expect(rankAirlines(flights)).toEqual([{ name: 'EVA Air', count: 4 }]);
  });

  test('is named by a name rather than the code, however often the code came back', () => {
    const flights = [
      createMockFlight({ id: 'a', airlineCode: 'JX', airlineName: 'JX' }),
      createMockFlight({ id: 'b', airlineCode: 'JX', airlineName: 'JX' }),
      createMockFlight({ id: 'c', airlineCode: 'JX', airlineName: 'Starlux' }),
    ];

    expect(rankAirlines(flights)).toEqual([{ name: 'Starlux', count: 3 }]);
  });

  test('keeps two airlines apart even with the same name', () => {
    const flights = [
      createMockFlight({ id: 'a', airlineCode: 'BR', airlineName: 'Example Air' }),
      createMockFlight({ id: 'b', airlineCode: 'JX', airlineName: 'Example Air' }),
    ];

    expect(rankAirlines(flights)).toHaveLength(2);
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

// Everyone leaves from home: a stamp for it says nothing, and it fills the first slot.
describe('the country you fly from', () => {
  const out = createMockFlight({ id: 'out', depCountry: 'TW', arrCountry: 'JP', distanceKm: 2100 });
  const back = createMockFlight({ id: 'back', depCountry: 'JP', arrCountry: 'TW', distanceKm: 2100 });

  test('gets no stamp', () => {
    expect(countryStamps([out, back], 'TW').map((s) => s.code)).toEqual(['JP']);
  });

  test('is not counted as visited', () => {
    const stats = computePassportStats([out, back], 'TW');

    expect(stats.visitedCountriesCount).toBe(1);
    expect(stats.visitedCountryCodes).toEqual(['JP']);
  });

  test('takes nothing from the flying itself', () => {
    const stats = computePassportStats([out, back], 'TW');

    expect(stats.totalFlights).toBe(2);
    expect(stats.totalKm).toBe(4200);
    expect(stats.airportVisits.length).toBeGreaterThan(0);
  });

  test('changes nothing until it is set', () => {
    expect(computePassportStats([out, back]).visitedCountriesCount).toBe(2);
    expect(countryStamps([out, back], null)).toHaveLength(2);
  });
});

describe('knownCountries', () => {
  test('lists the countries flights touch, the most first', () => {
    const flights = [
      createMockFlight({ id: 'a', depCountry: 'TW', arrCountry: 'JP' }),
      createMockFlight({ id: 'b', depCountry: 'TW', arrCountry: 'SG' }),
    ];

    expect(knownCountries(flights)[0]).toBe('TW');
    expect(knownCountries(flights).sort()).toEqual(['JP', 'SG', 'TW']);
  });

  // Home can be chosen before the first trip has been flown.
  test('counts flights still to come', () => {
    const booked = createMockFlight({ isFinished: false, depCountry: 'TW', arrCountry: 'JP' });

    expect(knownCountries([booked])).toContain('TW');
  });

  test('leaves out what nobody named', () => {
    expect(knownCountries([createMockFlight({ depCountry: null, arrCountry: null })])).toEqual([]);
  });
});

describe('trips', () => {
  const DAY = 24 * 3600 * 1000;
  const JUNE = Date.UTC(2026, 5, 1, 6, 0);

  // A flight `day` days into June, of three hours.
  const leg = (
    id: string,
    day: number,
    from: [iata: string, country: string],
    to: [iata: string, country: string],
  ) =>
    createMockFlight({
      id,
      depIata: from[0],
      depCountry: from[1],
      arrIata: to[0],
      arrCountry: to[1],
      depScheduledUtc: JUNE + day * DAY,
      arrScheduledUtc: JUNE + day * DAY + 3 * 3600 * 1000,
    });

  const TPE: [string, string] = ['TPE', 'TW'];
  const TSA: [string, string] = ['TSA', 'TW'];
  const KHH: [string, string] = ['KHH', 'TW'];
  const NRT: [string, string] = ['NRT', 'JP'];
  const KIX: [string, string] = ['KIX', 'JP'];
  const HKG: [string, string] = ['HKG', 'HK'];
  const SIN: [string, string] = ['SIN', 'SG'];

  const ids = (flights: FlightRecord[]) => tripsOf(flights).map((trip) => trip.map((f) => f.id));
  const visits = (flights: FlightRecord[]) =>
    Object.fromEntries(
      computePassportStats(flights).airportVisits.map(({ iata, count }) => [iata, count]),
    );

  test('there and back is one', () => {
    expect(ids([leg('out', 0, TPE, NRT), leg('back', 4, NRT, TPE)])).toEqual([['out', 'back']]);
  });

  test('a route through several places is one', () => {
    const flights = [leg('a', 0, TPE, HKG), leg('b', 3, HKG, SIN), leg('c', 6, SIN, TPE)];

    expect(ids(flights)).toEqual([['a', 'b', 'c']]);
  });

  test('coming home ends it, however soon the next one starts', () => {
    const flights = [
      leg('a', 0, TPE, NRT),
      leg('b', 2, NRT, TPE),
      leg('c', 3, TPE, HKG),
      leg('d', 5, HKG, TPE),
    ];

    expect(ids(flights)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  test('coming home to the other airport ends it too', () => {
    const flights = [leg('a', 0, TPE, NRT), leg('b', 2, NRT, TSA), leg('c', 3, TSA, KIX)];

    expect(ids(flights)).toEqual([['a', 'b'], ['c']]);
  });

  // Only the same airport joins two flights. In at Tokyo and out at Osaka is two.
  test('in at one airport and out at another in that country is two', () => {
    expect(ids([leg('in', 0, TPE, NRT), leg('out', 5, KIX, TPE)])).toEqual([['in'], ['out']]);
  });

  test('a flight within a country and back is one', () => {
    expect(ids([leg('a', 0, TPE, KHH), leg('b', 1, KHH, TPE)])).toEqual([['a', 'b']]);
  });

  test('coming home from within the country ends it too', () => {
    const flights = [leg('a', 0, TPE, KHH), leg('b', 1, KHH, TPE), leg('c', 2, TPE, KHH)];

    expect(ids(flights)).toEqual([['a', 'b'], ['c']]);
  });

  test('a long way apart it is two', () => {
    expect(ids([leg('a', 0, TPE, NRT), leg('b', 40, NRT, TPE)])).toEqual([['a'], ['b']]);
  });

  test('a flight from somewhere else is another', () => {
    expect(ids([leg('a', 0, TPE, NRT), leg('b', 2, SIN, TPE)])).toEqual([['a'], ['b']]);
  });

  test('go by when they happened, not when they were added', () => {
    expect(ids([leg('back', 4, NRT, TPE), leg('out', 0, TPE, NRT)])).toEqual([['out', 'back']]);
  });

  test('leave out what was not flown', () => {
    const booked = { ...leg('b', 4, NRT, TPE), isFinished: false };

    expect(ids([leg('a', 0, TPE, NRT), booked])).toEqual([['a']]);
  });

  describe('an airport', () => {
    test('counts once for a trip, not once a flight', () => {
      expect(visits([leg('out', 0, TPE, NRT), leg('back', 4, NRT, TPE)])).toEqual({ TPE: 1, NRT: 1 });
    });

    test('counts once for each trip that used it', () => {
      const flights = [
        leg('a', 0, TPE, NRT),
        leg('b', 2, NRT, TPE),
        leg('c', 10, TPE, NRT),
        leg('d', 12, NRT, TPE),
      ];

      expect(visits(flights)).toEqual({ TPE: 2, NRT: 2 });
    });

    test('counts in Tokyo and out Osaka as the two flights it was', () => {
      const flights = [leg('in', 0, TPE, NRT), leg('out', 5, KIX, TPE)];

      expect(visits(flights)).toEqual({ TPE: 2, NRT: 1, KIX: 1 });
    });

    test('counts each stop of a route through several places once', () => {
      const flights = [leg('a', 0, TPE, HKG), leg('b', 3, HKG, SIN), leg('c', 6, SIN, TPE)];

      expect(visits(flights)).toEqual({ TPE: 1, HKG: 1, SIN: 1 });
    });
  });

  test('take nothing from the count of flights', () => {
    const stats = computePassportStats([leg('out', 0, TPE, NRT), leg('back', 4, NRT, TPE)]);

    expect(stats.totalFlights).toBe(2);
  });
});

test('in Tokyo and out Osaka keeps both routes', () => {
  const inTokyo = createMockFlight({ id: 'in', depIata: 'TPE', arrIata: 'NRT' });
  const outOsaka = createMockFlight({ id: 'out', depIata: 'KIX', arrIata: 'TPE' });

  expect(rankRoutes([inTokyo, outOsaka])).toEqual([
    { from: 'KIX', to: 'TPE', count: 1 },
    { from: 'NRT', to: 'TPE', count: 1 },
  ]);
});

describe('journeys', () => {
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  const JUNE = Date.UTC(2026, 5, 1, 6, 0);

  // A flight of three hours, leaving `hours` hours into June.
  const leg = (
    id: string,
    hours: number,
    from: [iata: string, country: string],
    to: [iata: string, country: string],
  ) =>
    createMockFlight({
      id,
      depIata: from[0],
      depCountry: from[1],
      arrIata: to[0],
      arrCountry: to[1],
      depScheduledUtc: JUNE + hours * HOUR,
      arrScheduledUtc: JUNE + (hours + 3) * HOUR,
    });

  const TPE: [string, string] = ['TPE', 'TW'];
  const TSA: [string, string] = ['TSA', 'TW'];
  const KHH: [string, string] = ['KHH', 'TW'];
  const NRT: [string, string] = ['NRT', 'JP'];
  const KIX: [string, string] = ['KIX', 'JP'];
  const OKA: [string, string] = ['OKA', 'JP'];
  const ICN: [string, string] = ['ICN', 'KR'];
  const HKG: [string, string] = ['HKG', 'HK'];

  const stamps = (flights: FlightRecord[], home: string | null = 'TW') =>
    Object.fromEntries(countryStamps(flights, home).map((s) => [s.code, s.trips]));
  const airports = (flights: FlightRecord[], home: string | null = 'TW') =>
    Object.fromEntries(
      computePassportStats(flights, home).airportVisits.map(({ iata, count }) => [iata, count]),
    );

  describe('a holiday in one country', () => {
    const openJaw = [leg('in', 0, TPE, NRT), leg('out', 5 * 24, KIX, TPE)];

    // The rule in three layers, on one example.
    test('is one trip to the country, though the airports differ', () => {
      expect(stamps(openJaw)).toEqual({ JP: 1 });
    });

    test('keeps each airport as the flights had it', () => {
      expect(airports(openJaw)).toEqual({ TPE: 2, NRT: 1, KIX: 1 });
    });

    test('keeps both routes', () => {
      expect(rankRoutes(openJaw)).toHaveLength(2);
    });

    test('is one however many flights it took inside the country', () => {
      const flights = [
        leg('a', 0, TPE, NRT),
        leg('b', 3 * 24, NRT, OKA),
        leg('c', 6 * 24, OKA, TPE),
      ];

      expect(stamps(flights)).toEqual({ JP: 1 });
    });
  });

  test('two countries on one trip are one each', () => {
    const flights = [leg('a', 0, TPE, NRT), leg('b', 3 * 24, NRT, ICN), leg('c', 6 * 24, ICN, TPE)];

    expect(stamps(flights)).toEqual({ JP: 1, KR: 1 });
  });

  test('two trips to a country are two', () => {
    const flights = [
      leg('a', 0, TPE, NRT),
      leg('b', 3 * 24, NRT, TPE),
      leg('c', 10 * 24, TPE, KIX),
      leg('d', 13 * 24, KIX, TPE),
    ];

    expect(stamps(flights)).toEqual({ JP: 2 });
  });

  test('a stamp still lists every flight of it', () => {
    const flights = [leg('in', 0, TPE, NRT), leg('out', 5 * 24, KIX, TPE)];

    expect(countryStamps(flights, 'TW')[0].flights.map((f) => f.id)).toEqual(['out', 'in']);
  });

  describe('a stop on the way', () => {
    const through = (hoursThere: number) => [
      leg('a', 0, TPE, HKG),
      leg('b', 3 + hoursThere, HKG, NRT),
      leg('c', 10 * 24, NRT, TPE),
    ];

    test('of a day or less is not a visit', () => {
      expect(stamps(through(2))).toEqual({ JP: 1 });
      expect(computePassportStats(through(2), 'TW').visitedCountriesCount).toBe(1);
    });

    test('of exactly a day is not a visit', () => {
      expect(stamps(through(24))).toEqual({ JP: 1 });
    });

    test('of more than a day is', () => {
      expect(stamps(through(25))).toEqual({ HK: 1, JP: 1 });
    });

    test('still counts as an airport and a route', () => {
      expect(airports(through(2)).HKG).toBe(1);
      expect(rankRoutes(through(2))).toHaveLength(3);
    });

    // Flown there and back in a day: that was the destination, not a connection.
    test('is a visit when the next flight goes back', () => {
      const dayTrip = [leg('a', 0, TPE, HKG), leg('b', 8, HKG, TPE)];

      expect(stamps(dayTrip)).toEqual({ HK: 1 });
    });

    test('in the same country counts for the country', () => {
      const flights = [leg('a', 0, TPE, NRT), leg('b', 5, NRT, OKA), leg('c', 5 * 24, OKA, TPE)];

      expect(stamps(flights)).toEqual({ JP: 1 });
    });
  });

  describe('with a home country', () => {
    const longStay = [leg('a', 0, TPE, NRT), leg('b', 40 * 24, NRT, TPE)];

    test('a stay of any length is one trip', () => {
      expect(journeysOf(longStay, 'TW')).toHaveLength(1);
      expect(airports(longStay)).toEqual({ TPE: 1, NRT: 1 });
    });

    test('without one, a long enough stay is two', () => {
      expect(journeysOf(longStay, null)).toHaveLength(2);
      expect(tripsOf(longStay, null)).toHaveLength(2);
    });

    test('reaching it ends the trip, by any airport', () => {
      const flights = [leg('a', 0, TPE, NRT), leg('b', 3 * 24, NRT, TSA), leg('c', 4 * 24, TSA, KIX)];

      expect(journeysOf(flights, 'TW').map((j) => j.length)).toEqual([2, 1]);
    });

    test('reaching it ends a trip with no flight out on record', () => {
      const flights = [leg('back', 0, OKA, TPE), leg('next', 24, TPE, NRT)];

      expect(journeysOf(flights, 'TW').map((j) => j.length)).toEqual([1, 1]);
    });

    // A flight inside it is not coming home from anywhere.
    test('a flight within it does not end a trip at its first stop', () => {
      const flights = [leg('a', 0, TPE, KHH), leg('b', 24, KHH, TPE)];

      expect(airports(flights)).toEqual({ TPE: 1, KHH: 1 });
    });
  });

  test('without a home country the first flight says where home is', () => {
    const flights = [leg('in', 0, TPE, NRT), leg('out', 5 * 24, KIX, TPE), leg('c', 6 * 24, TPE, NRT)];

    expect(journeysOf(flights, null).map((j) => j.length)).toEqual([2, 1]);
  });

  test('a flight with no country joins nothing by country', () => {
    const typed = createMockFlight({ depIata: 'KIX', arrIata: 'TPE', depCountry: null, arrCountry: null });

    expect(journeysOf([leg('in', 0, TPE, NRT), typed], null)).toHaveLength(2);
  });
});
