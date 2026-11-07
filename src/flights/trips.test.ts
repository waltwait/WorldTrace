import { describe, expect, test } from 'vitest';
import { linkHeir, passportTrips, routeChain, tripDates, yearChoices } from './trips';
import type { FlightRecord } from './types';

const HOUR = 3600_000;

interface Airport {
  iata: string;
  country: string | null;
  tz: string;
}

const TPE: Airport = { iata: 'TPE', country: 'TW', tz: 'Asia/Taipei' };
const KHH: Airport = { iata: 'KHH', country: 'TW', tz: 'Asia/Taipei' };
const NRT: Airport = { iata: 'NRT', country: 'JP', tz: 'Asia/Tokyo' };
const KIX: Airport = { iata: 'KIX', country: 'JP', tz: 'Asia/Tokyo' };
const ICN: Airport = { iata: 'ICN', country: 'KR', tz: 'Asia/Seoul' };
const HKG: Airport = { iata: 'HKG', country: 'HK', tz: 'Asia/Hong_Kong' };
const LHR: Airport = { iata: 'LHR', country: 'GB', tz: 'Europe/London' };

/** A flight leaving at `when` (UTC, as an ISO string) and flying `hours`. */
function leg(
  id: string,
  when: string,
  from: Airport,
  to: Airport,
  hours = 3,
  overrides: Partial<FlightRecord> = {},
): FlightRecord {
  const dep = Date.parse(`${when}Z`);
  return {
    id,
    flightNumber: `XX${id.toUpperCase()}`,
    depDate: when.slice(0, 10),
    scheduleSource: 'api',
    airlineCode: 'XX',
    airlineName: 'Example Air',
    depIata: from.iata,
    arrIata: to.iata,
    depCountry: from.country,
    arrCountry: to.country,
    depScheduledUtc: dep,
    arrScheduledUtc: dep + hours * HOUR,
    depTz: from.tz,
    arrTz: to.tz,
    status: 'LANDED',
    durationMinutes: hours * 60,
    isFinished: true,
    createdAt: 0,
    ...overrides,
  };
}

describe('passportTrips', () => {
  const japan = [leg('a', '2026-07-01T00:25', TPE, NRT), leg('b', '2026-07-06T05:10', KIX, TPE)];

  test('in at Tokyo and out at Osaka is one trip to Japan', () => {
    const [trip] = passportTrips(japan, 'TW', null);

    expect(trip.flights.map((f) => f.id)).toEqual(['a', 'b']);
    expect(trip.title).toBe('日本');
    expect(trip.code).toBe('JP');
  });

  test('is known by its first flight', () => {
    expect(passportTrips(japan, 'TW', null)[0].key).toBe('a');
  });

  test('puts the newest trip first', () => {
    const korea = [leg('c', '2026-09-01T00:00', TPE, ICN), leg('d', '2026-09-04T00:00', ICN, TPE)];

    expect(passportTrips([...japan, ...korea], 'TW', null).map((t) => t.key)).toEqual(['c', 'a']);
  });

  test('leaves out a flight still to fly', () => {
    const booked = leg('b', '2026-07-06T05:10', KIX, TPE, 3, { isFinished: false });

    expect(passportTrips([japan[0], booked], 'TW', null)[0].flights).toHaveLength(1);
  });

  test('names every country it visited, in order', () => {
    const flights = [
      leg('a', '2026-07-01T00:00', TPE, NRT),
      leg('b', '2026-07-05T00:00', NRT, ICN),
      leg('c', '2026-07-09T00:00', ICN, TPE),
    ];

    expect(passportTrips(flights, 'TW', null)[0].title).toBe('日本、南韓');
  });

  test('does not name a connection', () => {
    const flights = [
      leg('a', '2026-07-01T00:00', TPE, HKG, 2),
      leg('b', '2026-07-01T04:00', HKG, LHR, 13),
      leg('c', '2026-07-10T00:00', LHR, TPE, 14),
    ];

    expect(passportTrips(flights, 'TW', null)[0].title).toBe('英國');
  });

  test('without a home country does not name where it began', () => {
    expect(passportTrips(japan, null, null)[0].title).toBe('日本');
  });

  test('within the home country is named for where it went', () => {
    const flights = [leg('a', '2026-07-01T00:00', TPE, KHH, 1), leg('b', '2026-07-03T00:00', KHH, TPE, 1)];
    const [trip] = passportTrips(flights, 'TW', null);

    expect(trip.title).toBe('台灣');
    expect(trip.code).toBe('TW');
  });

  test('with no countries known is named for the airport', () => {
    const typed = leg('a', '2026-07-01T00:00', TPE, NRT, 3, { depCountry: null, arrCountry: null });
    const [trip] = passportTrips([typed], null, null);

    expect(trip.title).toBe('NRT');
    expect(trip.code).toBeNull();
  });

  describe('in a year', () => {
    const newYear = [leg('a', '2025-12-28T00:00', TPE, NRT), leg('b', '2026-01-03T00:00', NRT, TPE)];

    test('is the year it began, flown whole', () => {
      const [trip] = passportTrips(newYear, 'TW', '2025');

      expect(trip.flights.map((f) => f.id)).toEqual(['a', 'b']);
    });

    test('is not the year it ended', () => {
      expect(passportTrips(newYear, 'TW', '2026')).toEqual([]);
    });
  });
});

describe('tripDates', () => {
  const dates = (flights: FlightRecord[], year: string | null) =>
    tripDates(passportTrips(flights, 'TW', null)[0], year);

  const japan = [leg('a', '2026-07-01T00:25', TPE, NRT), leg('b', '2026-07-06T05:10', KIX, TPE)];

  test('counts the days from leaving to landing back, both included', () => {
    expect(dates(japan, '2026')).toBe('7/1 – 7/6，6 天');
  });

  test('says the year when no year is chosen', () => {
    expect(dates(japan, null)).toBe('2026/7/1 – 7/6，6 天');
  });

  test('says both years for a trip across New Year', () => {
    const flights = [leg('a', '2025-12-28T00:00', TPE, NRT), leg('b', '2026-01-03T00:00', NRT, TPE)];

    expect(dates(flights, '2025')).toBe('2025/12/28 – 2026/1/3，7 天');
  });

  // Landing in Osaka at two in the morning on the 6th, while it is still the 5th in UTC.
  test('ends on the day it landed, on the clocks where it landed', () => {
    const flights = [leg('a', '2026-07-01T00:00', TPE, NRT), leg('b', '2026-07-05T15:30', NRT, KIX, 1.5)];

    expect(tripDates(passportTrips(flights, null, null)[0], '2026')).toBe('7/1 – 7/6，6 天');
  });

  test('of a single flight is only its day', () => {
    expect(dates([japan[0]], '2026')).toBe('7/1');
  });

  test('of a single flight says the year when no year is chosen', () => {
    expect(dates([japan[0]], null)).toBe('2026/7/1');
  });
});

describe('routeChain', () => {
  test('joins flights that carry on from where the last one landed', () => {
    const flights = [leg('a', '2026-07-01T00:00', TPE, HKG), leg('b', '2026-07-01T04:00', HKG, LHR)];

    expect(routeChain(flights)).toEqual([
      { kind: 'stop', iata: 'TPE' },
      { kind: 'flight', flightNumber: 'XXA' },
      { kind: 'stop', iata: 'HKG' },
      { kind: 'flight', flightNumber: 'XXB' },
      { kind: 'stop', iata: 'LHR' },
    ]);
  });

  test('goes over the ground between two airports', () => {
    const flights = [leg('a', '2026-07-01T00:00', TPE, NRT), leg('b', '2026-07-06T00:00', KIX, TPE)];

    expect(routeChain(flights)).toEqual([
      { kind: 'stop', iata: 'TPE' },
      { kind: 'flight', flightNumber: 'XXA' },
      { kind: 'stop', iata: 'NRT' },
      { kind: 'ground' },
      { kind: 'stop', iata: 'KIX' },
      { kind: 'flight', flightNumber: 'XXB' },
      { kind: 'stop', iata: 'TPE' },
    ]);
  });
});

describe('linkHeir', () => {
  const japan = [leg('a', '2026-07-01T00:00', TPE, NRT), leg('b', '2026-07-06T00:00', KIX, TPE)];
  const trips = passportTrips(japan, 'TW', null);

  test('is the first flight of the trip left once it is gone', () => {
    expect(linkHeir('a', trips)).toBe('b');
    expect(linkHeir('b', trips)).toBe('a');
  });

  test('is nobody for a trip of one flight', () => {
    expect(linkHeir('a', passportTrips([japan[0]], 'TW', null))).toBeNull();
  });

  test('is nobody for a flight in no trip', () => {
    expect(linkHeir('z', trips)).toBeNull();
  });
});

describe('yearChoices', () => {
  const flights = [
    leg('a', '2018-03-01T00:00', TPE, NRT),
    leg('b', '2018-03-05T00:00', NRT, TPE),
    leg('c', '2025-12-28T00:00', TPE, NRT),
    leg('d', '2026-01-03T00:00', NRT, TPE),
    leg('e', '2026-07-01T00:00', TPE, ICN),
  ];

  test('starts with every year, then the years, the newest first', () => {
    expect(yearChoices(flights, 'TW').map((c) => c.label)).toEqual(['ALL', '2026', '2025', '2018']);
  });

  // The same rule as the trips: a trip over New Year is the year it began, whole.
  test('counts the flights of the trips that began in each year', () => {
    expect(yearChoices(flights, 'TW').map((c) => [c.year, c.flights])).toEqual([
      [null, 5],
      ['2026', 1],
      ['2025', 2],
      ['2018', 2],
    ]);
  });

  test('of nothing flown is every year with none', () => {
    const booked = leg('x', '2026-07-01T00:00', TPE, NRT, 3, { isFinished: false });

    expect(yearChoices([booked], 'TW')).toEqual([{ year: null, label: 'ALL', flights: 0 }]);
  });
});
