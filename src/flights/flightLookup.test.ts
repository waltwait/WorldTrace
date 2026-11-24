import { describe, expect, test, vi } from 'vitest';
import { bestFlownDate, isWithinLookup, lookUpFlight, movedToDate, standInDates } from './flightLookup';
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
    expect(standInDates('2018-06-21', NOW).slice(0, 3)).toEqual([
      '2026-06-18',
      '2026-06-21',
      '2026-11-05',
    ]);
  });

  // A number that has stopped flying, as TR898 did in March 2026, is only to be found
  // in the oldest part of the year that can be asked about.
  test('then reaches back to the start of the year, and to halfway', () => {
    expect(standInDates('2018-06-21', NOW).slice(3)).toEqual(['2025-11-13', '2026-05-07']);
  });

  test('keeps the weekday in all but the date itself', () => {
    const dates = standInDates('2018-06-21', NOW);

    for (const date of [dates[0], ...dates.slice(2)]) {
      expect(weekday(date)).toBe(weekday('2018-06-21'));
    }
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

  // A timetable is in each airport's local time. Adding whole days of 24 hours
  // moved the clock with a daylight-saving change, and the date with it.
  test('keeps each end\'s local time across a daylight-saving change', () => {
    const summer: LookedUpFlight = {
      ...leg,
      depIata: 'LHR',
      depTz: 'Europe/London',
      depScheduledUtc: Date.UTC(2026, 6, 14, 23, 30), // 00:30 BST on 15 July
      arrScheduledUtc: Date.UTC(2026, 6, 15, 12, 30), // 20:30 in Taipei
    };
    const winter = movedToDate(summer, '2026-01-15');

    expect(utcToLocal(winter.depScheduledUtc, winter.depTz)).toEqual({
      date: '2026-01-15',
      time: '00:30',
    });
    expect(utcToLocal(winter.arrScheduledUtc, winter.arrTz)).toEqual({
      date: '2026-01-15',
      time: '20:30',
    });
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

  test('stops and says so when the request for the date itself gets no answer', async () => {
    const lookup = { findFlights: vi.fn(async () => null), flightDates: vi.fn(async () => null) };

    const { legs, notice } = await lookUpFlight(lookup, 'BR198', '2026-06-21', NOW);

    expect(legs).toEqual([]);
    expect(notice).toContain('連不上');
    expect(lookup.findFlights).toHaveBeenCalledTimes(1);
    expect(lookup.flightDates).not.toHaveBeenCalled();
  });

  // A stand-in day that answers after one that failed would put another day's
  // times on the flight, when only the request had gone wrong.
  test('stops at the first stand-in day that gets no answer, borrowing nothing', async () => {
    const answers: Array<LookedUpFlight[] | null> = [[], null, [leg]];
    const lookup = {
      findFlights: vi.fn(async () => (answers.length > 0 ? (answers.shift() as LookedUpFlight[] | null) : [])),
      flightDates: vi.fn(async () => ['2026-06-20', '2026-06-14']),
    };

    const { legs, notice } = await lookUpFlight(lookup, 'BR198', '2026-06-21', NOW);

    expect(legs).toEqual([]);
    expect(notice).toContain('連不上');
    expect(lookup.findFlights).toHaveBeenCalledTimes(2);
  });

  test('stops when an old date\'s stand-in gets no answer', async () => {
    const lookup = { findFlights: vi.fn(async () => null), flightDates: vi.fn(async () => null) };

    const { legs, notice } = await lookUpFlight(lookup, 'BR198', '2018-06-21', NOW);

    expect(legs).toEqual([]);
    expect(notice).toContain('連不上');
    expect(lookup.findFlights).toHaveBeenCalledTimes(1);
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

describe('bestFlownDate', () => {
  // 20 May 2024 was a Monday.
  test('takes the same weekday nearest the same date this year', () => {
    expect(bestFlownDate(['2026-03-22', '2026-03-23', '2026-03-16'], '2024-05-20', NOW)).toBe(
      '2026-03-23',
    );
  });

  test('takes the nearest when it never flew on that weekday', () => {
    expect(bestFlownDate(['2026-01-03', '2026-03-28'], '2024-05-20', NOW)).toBe('2026-03-28');
  });

  test('passes over a day that cannot be asked about, or has not come yet', () => {
    expect(bestFlownDate(['2024-05-20', '2026-12-07'], '2024-05-20', NOW)).toBeNull();
  });

  test('is nothing with nothing to choose from', () => {
    expect(bestFlownDate([], '2024-05-20', NOW)).toBeNull();
  });
});

describe('looking up a number that has stopped flying', () => {
  const flewUntilMarch = (dates: string[] | null) => ({
    findFlights: vi.fn(async (_n: string, date: string) => (date <= '2026-03-28' ? [leg] : [])),
    flightDates: vi.fn(async () => dates),
  });

  test('asks which days it flew, and looks up the best of them first', async () => {
    const port = flewUntilMarch(['2026-03-23', '2026-03-24']);

    const { legs } = await lookUpFlight(port, 'TR198', '2024-05-20', NOW);

    expect(port.findFlights).toHaveBeenCalledTimes(1);
    expect(port.findFlights).toHaveBeenCalledWith('TR198', '2026-03-23');
    expect(utcToLocal(legs[0].depScheduledUtc, legs[0].depTz).date).toBe('2024-05-20');
  });

  test('guesses as before when the API will not say, reaching back far enough', async () => {
    const port = flewUntilMarch(null);

    const { legs } = await lookUpFlight(port, 'TR198', '2024-05-20', NOW);

    expect(legs).toHaveLength(1);
  });

  test('does not ask which days it flew for a date it can look up itself', async () => {
    const port = flewUntilMarch(['2026-03-23']);

    await lookUpFlight(port, 'TR198', '2026-03-23', NOW);

    expect(port.flightDates).not.toHaveBeenCalled();
  });

  test('stops at once when the API reports no operating dates at all (204 -> [])', async () => {
    const port = {
      findFlights: vi.fn(async () => []),
      flightDates: vi.fn(async () => []),
    };

    const { legs, notice } = await lookUpFlight(port, 'CX9999', '2018-06-21', NOW);

    expect(legs).toEqual([]);
    expect(notice).toContain('查不到');
    expect(port.findFlights).not.toHaveBeenCalled();
  });
});

describe('looking up an in-range date missing from a sparse schedule (e.g. CX500 2027-03-11)', () => {
  const cx500: LookedUpFlight = {
    ...leg,
    flightNumber: 'CX500',
    airlineCode: 'CX',
    airlineName: 'Cathay Pacific',
    depIata: 'HKG',
    arrIata: 'NRT',
    depScheduledUtc: Date.UTC(2027, 2, 10, 7, 25), // 15:25 HKT on 2027-03-10
    arrScheduledUtc: Date.UTC(2027, 2, 10, 11, 20), // 20:20 JST on 2027-03-10
    depTz: 'Asia/Hong_Kong',
    arrTz: 'Asia/Tokyo',
    depCity: 'Hong Kong',
    arrCity: 'Tokyo',
    depCountry: 'HK',
    arrCountry: 'JP',
    distanceKm: 2962,
  };

  test('borrows a nearby filed date from flightDates when the requested date returns empty', async () => {
    const port = {
      findFlights: vi.fn(async (_n: string, date: string) =>
        date === '2027-03-10' ? [cx500] : [],
      ),
      flightDates: vi.fn(async () => ['2026-11-05', '2027-03-10']),
    };

    const { legs, notice } = await lookUpFlight(port, 'CX500', '2027-03-11', NOW);

    expect(port.findFlights).toHaveBeenCalledWith('CX500', '2027-03-11');
    expect(port.findFlights).toHaveBeenCalledWith('CX500', '2027-03-10');
    expect(port.findFlights).toHaveBeenCalledTimes(2);
    expect(legs).toHaveLength(1);
    expect(utcToLocal(legs[0].depScheduledUtc, legs[0].depTz)).toEqual({
      date: '2027-03-11',
      time: '15:25',
    });
    expect(legs[0].borrowed).toBe(true);
    expect(legs[0].depTerminal).toBeNull();
    expect(notice).toContain('鄰近班次');
  });

  test('prefers the same weekday near the target date over an adjacent different weekday', async () => {
    const thursdayWeekBefore: LookedUpFlight = {
      ...cx500,
      depScheduledUtc: Date.UTC(2027, 2, 4, 7, 25),
      arrScheduledUtc: Date.UTC(2027, 2, 4, 11, 20),
    };
    const port = {
      findFlights: vi.fn(async (_n: string, date: string) => {
        if (date === '2027-03-04') return [thursdayWeekBefore];
        if (date === '2027-03-10') return [cx500];
        return [];
      }),
      flightDates: vi.fn(async () => ['2027-03-04', '2027-03-10']),
    };

    const { legs } = await lookUpFlight(port, 'CX500', '2027-03-11', NOW);

    expect(port.findFlights).toHaveBeenNthCalledWith(2, 'CX500', '2027-03-04');
    expect(port.findFlights).toHaveBeenCalledTimes(2);
    expect(utcToLocal(legs[0].depScheduledUtc, legs[0].depTz).date).toBe('2027-03-11');
  });

  test('tries the adjacent day first, then past flown dates when flightDates only indexes history', async () => {
    const febLastYear: LookedUpFlight = {
      ...cx500,
      depScheduledUtc: Date.UTC(2026, 2, 12, 7, 25),
      arrScheduledUtc: Date.UTC(2026, 2, 12, 11, 20),
    };
    const portWith2027 = {
      findFlights: vi.fn(async (_n: string, date: string) =>
        date === '2027-03-10' ? [cx500] : date === '2026-03-12' ? [febLastYear] : [],
      ),
      flightDates: vi.fn(async () => ['2026-03-12', '2026-11-05']),
    };

    const hitAdjacent = await lookUpFlight(portWith2027, 'CX500', '2027-03-11', NOW);
    expect(portWith2027.findFlights).toHaveBeenNthCalledWith(2, 'CX500', '2027-03-10');
    expect(hitAdjacent.legs).toHaveLength(1);

    const portHistoryOnly = {
      findFlights: vi.fn(async (_n: string, date: string) =>
        date === '2026-03-12' ? [febLastYear] : [],
      ),
      flightDates: vi.fn(async () => ['2026-03-12', '2026-11-05']),
    };

    const hitHistory = await lookUpFlight(portHistoryOnly, 'CX500', '2027-03-11', NOW);
    expect(portHistoryOnly.findFlights).toHaveBeenCalledWith('CX500', '2026-03-12');
    expect(utcToLocal(hitHistory.legs[0].depScheduledUtc, hitHistory.legs[0].depTz)).toEqual({
      date: '2027-03-11',
      time: '15:25',
    });
  });

  test('still checks nearby days for a future flight when flightDates is unavailable', async () => {
    const port = {
      findFlights: vi.fn(async (_n: string, date: string) =>
        date === '2027-03-10' ? [cx500] : [],
      ),
    };

    const { legs, notice } = await lookUpFlight(port, 'CX500', '2027-03-11', NOW);

    expect(legs).toHaveLength(1);
    expect(legs[0].borrowed).toBe(true);
    expect(notice).toContain('鄰近班次');
  });

  test('does not probe further when flightDates says the flight number has zero dates', async () => {
    const port = {
      findFlights: vi.fn(async () => []),
      flightDates: vi.fn(async () => []),
    };

    const { legs, notice } = await lookUpFlight(port, 'CX9999', '2027-03-11', NOW);

    expect(legs).toEqual([]);
    expect(notice).toContain('查不到');
    expect(port.findFlights).toHaveBeenCalledTimes(1);
  });
});
