import { beforeEach, expect, test } from 'vitest';
import type { FlightStatusPort } from '../flights/flightStatusApi';
import type { FlightRecord } from '../flights/types';
import type { SqlDriver } from './driver';
import { refreshDueFlights } from './flightRefresh';
import { getFlightById, insertFlight } from './flights';
import { migrate } from './schema';
import { createNodeDriver } from './testing/nodeDriver';

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
});

const NOW = Date.UTC(2026, 10, 6, 2, 0);
const DAY = 24 * 3600 * 1000;

const tenDaysOut: FlightRecord = {
  id: 'f-1',
  flightNumber: 'BR198',
  airlineCode: 'BR',
  airlineName: 'EVA Air',
  depIata: 'TPE',
  arrIata: 'NRT',
  depScheduledUtc: NOW + 10 * DAY,
  arrScheduledUtc: NOW + 10 * DAY + 3 * 3600 * 1000,
  depTz: 'Asia/Taipei',
  arrTz: 'Asia/Tokyo',
  status: 'SCHEDULED',
  distanceMiles: 1300,
  durationMinutes: 180,
  notificationsEnabled: true,
  isFinished: false,
  lastSyncedAt: null,
  createdAt: NOW - DAY,
};

function countingPort(update = { status: 'SCHEDULED' as const }) {
  const calls: string[] = [];
  const port: FlightStatusPort = {
    fetchFlightStatus: async (num) => {
      calls.push(num);
      return update;
    },
  };
  return { port, calls };
}

test('an unchanged answer is still saved, so the next refresh does not ask again', async () => {
  await insertFlight(driver, tenDaysOut);
  const { port, calls } = countingPort();

  await refreshDueFlights(driver, port, NOW);
  expect((await getFlightById(driver, 'f-1'))?.lastSyncedAt).toBe(NOW);

  // An hour later, ten days out, the schedule says once a day.
  await refreshDueFlights(driver, port, NOW + 3600 * 1000);
  expect(calls).toEqual(['BR198']);
});

test('saves every field a sync changed, not just status and departure gate', async () => {
  await insertFlight(driver, tenDaysOut);
  const { port } = countingPort({
    status: 'SCHEDULED',
    arrGate: '12',
    baggageBelt: '3',
    arrTerminal: '2',
  } as never);

  const [shown] = await refreshDueFlights(driver, port, NOW);
  const saved = await getFlightById(driver, 'f-1');
  expect([saved?.arrGate, saved?.baggageBelt, saved?.arrTerminal]).toEqual(['12', '3', '2']);
  expect(shown).toEqual(saved);
});
