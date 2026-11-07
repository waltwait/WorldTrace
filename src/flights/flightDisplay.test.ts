import { describe, expect, test } from 'vitest';
import {
  airportDate,
  airportLabel,
  airportTime,
  departureCountdown,
  nextFlight,
  pastFlights,
  statusLabel,
  ticketFor,
  upcomingFlights,
  walletFlight,
} from './flightDisplay';
import type { FlightRecord } from './types';

const HOUR = 3600 * 1000;

// TPE 23:40 on 1 December → LAX 19:30 the same calendar day.
const tpeLax: FlightRecord = {
  id: 'f',
  flightNumber: 'BR12',
  depDate: '2026-12-01',
  scheduleSource: 'api',
  airlineCode: 'BR',
  airlineName: 'EVA Air',
  depIata: 'TPE',
  arrIata: 'LAX',
  depScheduledUtc: Date.UTC(2026, 11, 1, 15, 40),
  arrScheduledUtc: Date.UTC(2026, 11, 2, 3, 30),
  depTz: 'Asia/Taipei',
  arrTz: 'America/Los_Angeles',
  status: 'SCHEDULED',
  distanceKm: 6800,
  durationMinutes: 710,
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

  test('says the flight is in the air, instead of leaving today', () => {
    expect(departureCountdown(tpeLax, tpeLax.depScheduledUtc + HOUR)).toBe('飛行中');
  });

  // Nobody has said it landed: the clock only says it should have. Only an
  // arrival from the API or the user's own word finishes a flight.
  test('past its arrival time, unconfirmed, it asks instead of claiming it landed', () => {
    expect(departureCountdown(tpeLax, tpeLax.arrScheduledUtc + 72 * HOUR)).toBe('待確認');
  });

  test('a cancelled flight is cancelled, before, during and after its times', () => {
    const cancelled = { ...tpeLax, status: 'CANCELLED' as const };
    expect(departureCountdown(cancelled, tpeLax.depScheduledUtc - HOUR)).toBe('已取消');
    expect(departureCountdown(cancelled, tpeLax.depScheduledUtc + HOUR)).toBe('已取消');
    expect(departureCountdown(cancelled, tpeLax.arrScheduledUtc + HOUR)).toBe('已取消');
  });

  test('a finished flight is finished', () => {
    expect(departureCountdown({ ...tpeLax, isFinished: true }, 0)).toBe('已完成');
  });
});

describe('statusLabel', () => {
  test('says the status in Chinese', () => {
    expect(statusLabel({ ...tpeLax, status: 'SCHEDULED' })).toBe('已排定');
    expect(statusLabel({ ...tpeLax, status: 'BOARDING' })).toBe('登機中');
    expect(statusLabel({ ...tpeLax, status: 'IN_AIR' })).toBe('飛行中');
    expect(statusLabel({ ...tpeLax, status: 'LANDED' })).toBe('已降落');
    expect(statusLabel({ ...tpeLax, status: 'DELAYED' })).toBe('延誤');
  });

  test('a finished flight is finished, but a cancelled one stays cancelled', () => {
    expect(statusLabel({ ...tpeLax, isFinished: true })).toBe('已完成');
    expect(statusLabel({ ...tpeLax, status: 'CANCELLED', isFinished: true })).toBe('已取消');
  });
});

describe('the two lists', () => {
  const on = (id: string, day: number, extra: Partial<FlightRecord> = {}): FlightRecord => ({
    ...tpeLax,
    id,
    depScheduledUtc: Date.UTC(2026, 11, day),
    ...extra,
  });
  const ids = (flights: FlightRecord[]) => flights.map((f) => f.id);

  test('upcoming puts the next flight first, whatever order they arrive in', () => {
    expect(ids(upcomingFlights([on('late', 20), on('next', 1), on('mid', 10)]))).toEqual([
      'next',
      'mid',
      'late',
    ]);
  });

  test('past puts the latest flight first', () => {
    const flown = { isFinished: true };
    expect(ids(pastFlights([on('old', 1, flown), on('new', 20, flown)]))).toEqual(['new', 'old']);
  });

  test('a cancelled flight has left the upcoming list for the past one', () => {
    const flights = [on('off', 5, { status: 'CANCELLED' }), on('on', 6)];
    expect(ids(upcomingFlights(flights))).toEqual(['on']);
    expect(ids(pastFlights(flights))).toEqual(['off']);
  });

  test('neither list reorders what it was given', () => {
    const flights = [on('late', 20), on('next', 1)];
    upcomingFlights(flights);
    expect(ids(flights)).toEqual(['late', 'next']);
  });
});

describe('airportLabel', () => {
  test('is the city with the code', () => {
    expect(airportLabel('Taipei', 'TPE')).toBe('Taipei (TPE)');
  });

  test('is the code alone for a flight typed in with no city', () => {
    expect(airportLabel(null, 'TPE')).toBe('TPE');
  });
});

describe('nextFlight', () => {
  const on = (id: string, day: number, extra: Partial<FlightRecord> = {}): FlightRecord => ({
    ...tpeLax,
    id,
    depScheduledUtc: Date.UTC(2026, 11, day),
    arrScheduledUtc: Date.UTC(2026, 11, day, 12),
    ...extra,
  });
  const NOW = Date.UTC(2026, 11, 5);

  test('is the soonest one still to leave', () => {
    expect(nextFlight([on('late', 20), on('soon', 10)], NOW)?.id).toBe('soon');
  });

  test('is one in the air before one still to come', () => {
    const inAir = on('air', 4, { arrScheduledUtc: NOW + HOUR });
    expect(nextFlight([on('soon', 10), inAir], NOW)?.id).toBe('air');
  });

  test('leaves out flights over, cancelled, or past their arrival', () => {
    const flights = [
      on('done', 10, { isFinished: true }),
      on('off', 11, { status: 'CANCELLED' }),
      on('gone', 1),
    ];
    expect(nextFlight(flights, NOW)).toBeNull();
  });
});

describe('walletFlight', () => {
  const on = (id: string, day: number, extra: Partial<FlightRecord> = {}): FlightRecord => ({
    ...tpeLax,
    id,
    depScheduledUtc: Date.UTC(2026, 11, day),
    arrScheduledUtc: Date.UTC(2026, 11, day, 12),
    ...extra,
  });
  const NOW = Date.UTC(2026, 11, 5);

  test('is the next flight when there is one', () => {
    const flights = [on('flown', 1, { isFinished: true }), on('soon', 10)];

    expect(walletFlight(flights, NOW)).toMatchObject({ flight: { id: 'soon' }, label: '下一班' });
  });

  test('is the last one flown when none is coming', () => {
    const flights = [on('old', 1, { isFinished: true }), on('recent', 3, { isFinished: true })];

    expect(walletFlight(flights, NOW)).toMatchObject({ flight: { id: 'recent' }, label: '上一班' });
  });

  // It was never flown, so it is nobody's last flight.
  test('passes over a cancelled flight', () => {
    const flights = [
      on('flown', 1, { isFinished: true }),
      on('off', 3, { status: 'CANCELLED', isFinished: true }),
    ];

    expect(walletFlight(flights, NOW)?.flight.id).toBe('flown');
  });

  test('is nothing with no flights', () => {
    expect(walletFlight([], NOW)).toBeNull();
  });
});

describe('ticketFor', () => {
  const before = tpeLax.depScheduledUtc - 10 * 24 * HOUR;

  test('shows the route and when it leaves, on the airport\'s clock', () => {
    const ticket = ticketFor({ ...tpeLax, flightNumber: 'BR12' }, before);

    expect(ticket.from).toBe('TPE');
    expect(ticket.to).toBe('LAX');
    expect(ticket.when).toBe('12 月 1 日 23:40');
  });

  test('counts the days down on the stub', () => {
    const ticket = ticketFor(tpeLax, before);

    expect([ticket.stubLabel, ticket.stubValue]).toEqual(['還有', '10 天']);
    expect(ticket.past).toBe(false);
  });

  test('says when it leaves today', () => {
    const ticket = ticketFor(tpeLax, tpeLax.depScheduledUtc - HOUR);

    expect([ticket.stubLabel, ticket.stubValue]).toEqual(['今天', '出發']);
  });

  test('says it is in the air', () => {
    expect(ticketFor(tpeLax, tpeLax.depScheduledUtc + HOUR).stubValue).toBe('飛行中');
  });

  test('asks about one past its arrival that nobody confirmed', () => {
    expect(ticketFor(tpeLax, tpeLax.arrScheduledUtc + HOUR).stubValue).toBe('待確認');
  });

  test('a flight flown keeps its seat on the stub', () => {
    const ticket = ticketFor({ ...tpeLax, isFinished: true, seat: '62H' }, 0);

    expect([ticket.stubLabel, ticket.stubValue]).toEqual(['座位', '62H']);
    expect(ticket.past).toBe(true);
  });

  test('a flight flown with no seat just says so', () => {
    expect(ticketFor({ ...tpeLax, isFinished: true }, 0).stubValue).toBe('已完成');
  });

  test('a cancelled flight says so, whatever else is true', () => {
    const ticket = ticketFor({ ...tpeLax, status: 'CANCELLED', seat: '62H' }, before);

    expect(ticket.stubValue).toBe('已取消');
    expect(ticket.past).toBe(true);
  });
});
