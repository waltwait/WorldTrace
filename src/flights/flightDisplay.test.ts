import { describe, expect, test } from 'vitest';
import { airportDate, airportTime, departureCountdown } from './flightDisplay';
import type { FlightRecord } from './types';

const HOUR = 3600 * 1000;

// TPE 23:40 on 1 December → LAX 19:30 the same calendar day.
const tpeLax: FlightRecord = {
  id: 'f',
  flightNumber: 'BR12',
  airlineCode: 'BR',
  airlineName: 'EVA Air',
  depIata: 'TPE',
  arrIata: 'LAX',
  depScheduledUtc: Date.UTC(2026, 11, 1, 15, 40),
  arrScheduledUtc: Date.UTC(2026, 11, 2, 3, 30),
  depTz: 'Asia/Taipei',
  arrTz: 'America/Los_Angeles',
  status: 'SCHEDULED',
  distanceMiles: 6800,
  durationMinutes: 710,
  notificationsEnabled: true,
  isFinished: false,
  createdAt: 0,
};

describe('airportTime and airportDate', () => {
  test('show each end of a flight on its own airport\'s clocks, whatever the phone is set to', () => {
    expect(airportTime(tpeLax.depScheduledUtc, tpeLax.depTz)).toBe('23:40');
    expect(airportTime(tpeLax.arrScheduledUtc, tpeLax.arrTz)).toBe('19:30');
    expect(airportDate(tpeLax.depScheduledUtc, tpeLax.depTz)).toBe('2026/12/1');
    expect(airportDate(tpeLax.arrScheduledUtc, tpeLax.arrTz)).toBe('2026/12/1');
  });
});

describe('departureCountdown', () => {
  test('a flight leaving later today, two hours out, leaves today', () => {
    expect(departureCountdown(tpeLax, tpeLax.depScheduledUtc - 2 * HOUR)).toBe('今日出發');
  });

  test('counts days on the departure airport\'s calendar, not in blocks of 24 hours', () => {
    // 08:00 on 30 November in Taipei: 31 h 40 m to go, but it leaves tomorrow.
    expect(departureCountdown(tpeLax, Date.UTC(2026, 10, 30, 0, 0))).toBe('1 天');
    expect(departureCountdown(tpeLax, Date.UTC(2026, 10, 21, 0, 0))).toBe('10 天');
  });

  test('says the flight is in the air, then landed, instead of leaving today', () => {
    expect(departureCountdown(tpeLax, tpeLax.depScheduledUtc + HOUR)).toBe('飛行中');
    expect(departureCountdown(tpeLax, tpeLax.arrScheduledUtc + 72 * HOUR)).toBe('已抵達');
  });

  test('a finished flight is finished', () => {
    expect(departureCountdown({ ...tpeLax, isFinished: true }, 0)).toBe('已完成');
  });
});
