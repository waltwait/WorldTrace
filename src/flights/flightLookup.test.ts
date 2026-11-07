import { describe, expect, test, vi } from 'vitest';
import { isWithinLookup, lookUpFlight, movedToDate, standInDates } from './flightLookup';
import type { LookedUpFlight } from './types';
import { utcToLocal } from './zonedTime';

const NOW = Date.UTC(2026, 10, 7, 2, 0); // Saturday 7 November 2026

const leg: LookedUpFlight = {
  flightNumber: 'BR198',
  airlineCode: 'BR',
  airlineName: 'EVA Air',
  depIata: 'NRT',
  arrIata: 'TPE',
  depScheduledUtc: Date.UTC(2026, 5, 18, 11, 0), // 20:00 in Tokyo
  arrScheduledUtc: Date.UTC(2026, 5, 18, 14, 30),
  depTz: 'Asia/Tokyo',
  arrTz: 'Asia/Taipei',
  depTerminal: '1',
  arrTerminal: '2',
  depCity: 'Tokyo',
  arrCity: 'Taipei',
  depCountry: 'JP',
  arrCountry: 'TW',
  depLat: 35.7,
  depLon: 140.3,
  arrLat: 25.0,
  arrLon: 121.2,
  distanceKm: 2180,
  depGate: '71',
  arrGate: 'B5',
  status: 'CANCELLED',
};

describe('isWithinLookup', () => {
  test('takes dates up to a year either way', () => {
    expect(isWithinLookup('2026-06-21', NOW)).toBe(true);
    expect(isWithinLookup('2027-06-21', NOW)).toBe(true);
  });

  test('refuses anything further', () => {
    expect(isWithinLookup('2018-06-21', NOW)).toBe(false);
    expect(isWithinLookup('2028-06-21', NOW)).toBe(false);
  });
});

describe('standInDates', () => {
  const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

  // 21 June 2018 was a Thursday. A timetable runs by the weekday and the season, so
  // the Thursday nearest that date this year comes first, then the date itself.
  test('tries the same weekday near the same date, the date, then the last such weekday', () => {
    expect(standInDates('2018-06-21', NOW)).toEqual(['2026-06-18', '2026-06-21', '2026-11-05']);
  });

  test('keeps the weekday in the first and the last', () => {
    const dates = standInDates('2018-06-21', NOW);

    expect(weekday(dates[0])).toBe(weekday('2018-06-21'));
    expect(weekday(dates[2])).toBe(weekday('2018-06-21'));
  });

  test('goes back a year when the date has not come round yet', () => {
    expect(standInDates('2019-12-24', NOW)[0]).toBe('2025-12-23');
  });

  test('stays inside what can be looked up', () => {
    for (const date of standInDates('2018-11-08', NOW)) {
      expect(isWithinLookup(date, NOW)).toBe(true);
      expect(date < '2026-11-07').toBe(true);
    }
  });

  test('gives no date twice', () => {
    // 2015-11-05 was a Thursday, as is the fifth of this month.
    const dates = standInDates('2015-11-05', NOW);

    expect(new Set(dates).size).toBe(dates.length);
  });

  test('copes with a leap day', () => {
    expect(standInDates('2016-02-29', NOW).length).toBeGreaterThan(0);
  });
});

describe('movedToDate', () => {
  const moved = movedToDate(leg, '2018-06-21');

  test('leaves on the date asked for, at the same time of day', () => {
    expect(utcToLocal(moved.depScheduledUtc, moved.depTz)).toEqual({
      date: '2018-06-21',
      time: '20:00',
    });
  });

  test('keeps the length of the flight', () => {
    expect(moved.arrScheduledUtc - moved.depScheduledUtc).toBe(3.5 * 3600 * 1000);
  });

  test('keeps the route', () => {
    expect([moved.depIata, moved.arrIata, moved.arrCountry, moved.distanceKm]).toEqual([
      'NRT',
      'TPE',
      'TW',
      2180,
    ]);
  });

  // What happened on another day did not happen on this one.
  test('drops what belongs to that day alone', () => {
    expect([moved.depGate, moved.arrGate, moved.depTerminal, moved.arrTerminal]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(moved.status).toBe('SCHEDULED');
  });

  test('says it was borrowed', () => {
    expect(moved.borrowed).toBe(true);
  });
});

describe('lookUpFlight', () => {
  const port = (found: Record<string, LookedUpFlight[]>) => ({
    findFlights: vi.fn(async (_number: string, date: string) => found[date] ?? []),
  });

  test('asks for the date itself when it can', async () => {
    const lookup = port({ '2026-06-21': [leg] });

    const { legs, notice } = await lookUpFlight(lookup, 'BR198', '2026-06-21', NOW);

    expect(legs).toEqual([leg]);
    expect(notice).toBeNull();
  });

  test('says when a date it could ask for found nothing', async () => {
    const lookup = port({});

    const { legs, notice } = await lookUpFlight(lookup, 'BR198', '2026-06-21', NOW);

    expect(legs).toEqual([]);
    expect(notice).toContain('查不到');
    expect(lookup.findFlights).toHaveBeenCalledTimes(1);
  });

  describe('for a date too old to ask for', () => {
    test('never asks for it: the API refuses, and it costs the same', async () => {
      const lookup = port({ '2026-06-18': [leg] });

      await lookUpFlight(lookup, 'BR198', '2018-06-21', NOW);

      expect(lookup.findFlights).not.toHaveBeenCalledWith('BR198', '2018-06-21');
    });

    test('moves what it finds onto the date, and says where it came from', async () => {
      const lookup = port({ '2026-06-18': [leg] });

      const { legs, notice } = await lookUpFlight(lookup, 'BR198', '2018-06-21', NOW);

      expect(utcToLocal(legs[0].depScheduledUtc, legs[0].depTz).date).toBe('2018-06-21');
      expect(legs[0].borrowed).toBe(true);
      expect(notice).toContain('近期班次');
    });

    test('stops at the first date with an answer: each one costs', async () => {
      const lookup = port({ '2026-06-18': [leg], '2026-06-21': [leg] });

      await lookUpFlight(lookup, 'BR198', '2018-06-21', NOW);

      expect(lookup.findFlights).toHaveBeenCalledTimes(1);
    });

    test('goes on when a date has nothing', async () => {
      const lookup = port({ '2026-11-05': [leg] });

      const { legs } = await lookUpFlight(lookup, 'BR198', '2018-06-21', NOW);

      expect(legs).toHaveLength(1);
      expect(lookup.findFlights).toHaveBeenCalledTimes(3);
    });

    test('says so when none has anything', async () => {
      const { legs, notice } = await lookUpFlight(port({}), 'BR198', '2018-06-21', NOW);

      expect(legs).toEqual([]);
      expect(notice).toContain('查不到');
    });
  });

  test('does not ask about a date too far ahead', async () => {
    const lookup = port({});

    const { notice } = await lookUpFlight(lookup, 'BR198', '2028-06-21', NOW);

    expect(lookup.findFlights).not.toHaveBeenCalled();
    expect(notice).toContain('一年');
  });
});
