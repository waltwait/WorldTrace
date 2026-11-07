import { describe, expect, test } from 'vitest';
import {
  CARD_DIMENSIONS,
  buildTripShareModel,
  buildYearShareModel,
  shareTicketFor,
} from './shareCard';
import { passportTrips } from './trips';
import type { FlightRecord } from './types';

const HOUR = 3600_000;

function leg(
  id: string,
  whenUtc: string,
  from: [iata: string, country: string | null, tz: string],
  to: [iata: string, country: string | null, tz: string],
  hours = 3,
  overrides: Partial<FlightRecord> = {},
): FlightRecord {
  const dep = Date.parse(whenUtc);
  return {
    id,
    flightNumber: `JX${id}`,
    depDate: whenUtc.slice(0, 10),
    scheduleSource: 'api',
    airlineCode: 'JX',
    airlineName: 'Starlux Airlines',
    depIata: from[0],
    arrIata: to[0],
    depCountry: from[1],
    arrCountry: to[1],
    depScheduledUtc: dep,
    arrScheduledUtc: dep + hours * HOUR,
    depTz: from[2],
    arrTz: to[2],
    status: 'LANDED',
    distanceKm: 2000,
    durationMinutes: hours * 60,
    seat: '12A',
    isFinished: true,
    createdAt: 0,
    ...overrides,
  };
}

const TPE: [string, string, string] = ['TPE', 'TW', 'Asia/Taipei'];
const TSA: [string, string, string] = ['TSA', 'TW', 'Asia/Taipei'];
const NRT: [string, string, string] = ['NRT', 'JP', 'Asia/Tokyo'];
const KIX: [string, string, string] = ['KIX', 'JP', 'Asia/Tokyo'];
const HKG: [string, string, string] = ['HKG', 'HK', 'Asia/Hong_Kong'];
const LHR: [string, string, string] = ['LHR', 'GB', 'Europe/London'];
const ICN: [string, string, string] = ['ICN', 'KR', 'Asia/Seoul'];
const SIN: [string, string, string] = ['SIN', 'SG', 'Asia/Singapore'];
const BKK: [string, string, string] = ['BKK', 'TH', 'Asia/Bangkok'];
const DAD: [string, string, string] = ['DAD', 'VN', 'Asia/Ho_Chi_Minh'];
const MNL: [string, string, string] = ['MNL', 'PH', 'Asia/Manila'];

describe('CARD_DIMENSIONS', () => {
  test('defines logical 360dp cards that export at 3x to 1080x1920 and 1080x1350', () => {
    expect(CARD_DIMENSIONS['9:16']).toEqual({
      logicalWidth: 360,
      logicalHeight: 640,
      pixelWidth: 1080,
      pixelHeight: 1920,
    });
    expect(CARD_DIMENSIONS['4:5']).toEqual({
      logicalWidth: 360,
      logicalHeight: 450,
      pixelWidth: 1080,
      pixelHeight: 1350,
    });
  });
});

describe('shareTicketFor', () => {
  test('puts flight number on the stub, never exposes seat, and shows local departure and arrival times', () => {
    // 00:30 UTC = 08:30 Taipei; +3h20m -> 03:50 UTC = 12:50 Tokyo
    const f = leg('800', '2026-04-02T00:30:00Z', TPE, NRT, 200 / 60, {
      flightNumber: 'JX800',
      seat: '12A',
    });

    const view = shareTicketFor(f);

    expect(view.stubLabel).toBe('');
    expect(view.stubValue).toBe('JX800');
    expect(JSON.stringify(view)).not.toContain('12A');
    expect(view.when).toBe('4 月 2 日 08:30 – 12:50');
    expect(view.heading).toBe('Starlux Airlines');
    expect(view.past).toBe(true);
  });

  test('marks overnight arrival with +1 on the arrival airport calendar', () => {
    // 15:40 UTC Apr 2 = 23:40 Taipei Apr 2; +13h -> 04:40 UTC Apr 3 = 05:40 London Apr 3 (+1 day)
    const overnight = leg('61', '2026-04-02T15:40:00Z', TPE, LHR, 13, {
      depDate: '2026-04-02',
    });

    expect(shareTicketFor(overnight).when).toBe('4 月 2 日 23:40 – 05:40 +1');
  });
});

describe('buildTripShareModel', () => {
  test('builds a 2-flight open-jaw trip with full tickets on 9:16 and compact tickets on 4:5, leaving out connections and seats', () => {
    const flights = [
      leg('800', '2026-04-02T00:30:00Z', TPE, NRT, 3, { distanceKm: 2180 }),
      leg('823', '2026-04-08T05:10:00Z', KIX, TPE, 3, { distanceKm: 1873 }),
    ];
    const [trip] = passportTrips(flights, 'TW', null);

    const tall = buildTripShareModel(trip, '9:16', 'TW');
    const feed = buildTripShareModel(trip, '4:5', 'TW');

    expect(tall.flags).toEqual(['🇯🇵']);
    expect(tall.title).toBe('日本');
    expect(tall.dates).toBe('2026/4/2 – 4/8，7 天');
    expect(tall.badge).toBe('2 班 · 4,053 km');
    expect(tall.compactTickets).toBe(false);
    expect(tall.tickets).toHaveLength(2);
    expect(tall.overflowCount).toBe(0);
    expect(tall.fileName).toBe('worldtrace-trip-2026-04-02-9x16.png');

    expect(feed.compactTickets).toBe(true);
    expect(feed.tickets).toHaveLength(2);
    expect(feed.fileName).toBe('worldtrace-trip-2026-04-02-4x5.png');
  });

  test('switches to compact tickets and caps overflow cleanly when a trip has many flights', () => {
    const many = [
      leg('1', '2026-05-01T00:00:00Z', TPE, HKG, 2),
      leg('2', '2026-05-01T04:00:00Z', HKG, LHR, 13),
      leg('3', '2026-05-04T10:00:00Z', LHR, SIN, 13),
      leg('4', '2026-05-07T02:00:00Z', SIN, BKK, 2.5),
      leg('5', '2026-05-10T06:00:00Z', BKK, TPE, 3.5),
    ];
    const [trip] = passportTrips(many, 'TW', null);

    const tall = buildTripShareModel(trip, '9:16', 'TW');
    const feed = buildTripShareModel(trip, '4:5', 'TW');

    // HKG is a 2h connection on the way to LHR, so it gets no flag in the header.
    expect(tall.flags).toEqual(['🇬🇧', '🇸🇬', '🇹🇭']);
    expect(tall.compactTickets).toBe(true);
    expect(tall.tickets).toHaveLength(3);
    expect(tall.overflowCount).toBe(2);

    expect(feed.tickets).toHaveLength(2);
    expect(feed.overflowCount).toBe(3);
  });

  test('drops distance from badge when no flight knows its distance', () => {
    const manual = [leg('1', '2026-04-02T00:30:00Z', TPE, NRT, 3, { distanceKm: undefined })];
    const [trip] = passportTrips(manual, 'TW', null);

    expect(buildTripShareModel(trip, '9:16', 'TW').badge).toBe('1 班');
  });
});

describe('buildYearShareModel', () => {
  test('keeps a cross-New-Year trip whole in the year it began, matching totals and trip rows', () => {
    const newYear = [
      leg('1', '2026-12-29T01:00:00Z', TPE, NRT, 3, {
        depDate: '2026-12-29',
        distanceKm: 2180,
      }),
      leg('2', '2027-01-03T06:00:00Z', NRT, TPE, 3.5, {
        depDate: '2027-01-03',
        distanceKm: 2180,
      }),
    ];

    const y2026 = buildYearShareModel(newYear, 'TW', '2026', '9:16');

    expect(y2026.periodLabel).toBe('2026');
    expect(y2026.totalFlights).toBe(2);
    expect(y2026.totalHours).toBe('6.5');
    expect(y2026.totalKmLabel).toBe('4,360 km');
    // The user took the laps of the Earth out of the passport, the picture included.
    expect(y2026).not.toHaveProperty('earthLapsLabel');
    expect(y2026.flags).toEqual(['🇯🇵']);
    expect(y2026.tripCount).toBe(1);
    expect(y2026.rows).toEqual([
      {
        flag: '🇯🇵',
        title: '日本',
        route: 'TPE → NRT → TPE',
        dates: '2026/12/29 – 2027/1/3，6 天',
      },
    ]);
    expect(y2026.fileName).toBe('worldtrace-passport-2026-9x16.png');
  });

  test('formats open-jaw routes with a middle dot and caps rows per aspect ratio', () => {
    const destinations = [NRT, ICN, SIN, BKK, DAD, MNL, LHR];
    const flights = destinations.flatMap((dest, idx) => {
      const month = String(idx + 2).padStart(2, '0');
      const out = leg(`${idx}a`, `2026-${month}-02T01:00:00Z`, idx === 1 ? TSA : TPE, dest, 3, {
        depDate: `2026-${month}-02`,
      });
      const backFrom = idx === 0 ? KIX : dest;
      const back = leg(`${idx}b`, `2026-${month}-06T06:00:00Z`, backFrom, idx === 1 ? TSA : TPE, 3, {
        depDate: `2026-${month}-06`,
      });
      return [out, back];
    });

    const tall = buildYearShareModel(flights, 'TW', null, '9:16');
    const feed = buildYearShareModel(flights, 'TW', null, '4:5');

    expect(tall.periodLabel).toBe('ALL');
    expect(tall.tripCount).toBe(7);
    expect(tall.rows).toHaveLength(5);
    expect(tall.overflowTrips).toBe(2);
    expect(tall.fileName).toBe('worldtrace-passport-all-9x16.png');

    expect(feed.rows).toHaveLength(3);
    expect(feed.overflowTrips).toBe(4);

    // Open-jaw trip (in at NRT, out at KIX) renders with middle dot
    const allRows = buildYearShareModel(flights.slice(0, 2), 'TW', '2026', '9:16').rows;
    expect(allRows[0].route).toBe('TPE → NRT · KIX → TPE');
  });
});
