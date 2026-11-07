import { beforeEach, describe, expect, test } from 'vitest';
import type { FlightStatusPort } from '../flights/flightStatusApi';
import type { FlightRecord } from '../flights/types';
import type { SqlDriver } from './driver';
import { refreshDueFlights, saveSyncedFlight } from './flightRefresh';
import { deleteFlight, getFlightById, insertFlight, updateFlight } from './flights';
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
  depDate: '2026-12-01',
  scheduleSource: 'api',
  airlineCode: 'BR',
  airlineName: 'EVA Air',
  depIata: 'TPE',
  arrIata: 'NRT',
  depScheduledUtc: NOW + 10 * DAY,
  arrScheduledUtc: NOW + 10 * DAY + 3 * 3600 * 1000,
  depTz: 'Asia/Taipei',
  arrTz: 'Asia/Tokyo',
  status: 'SCHEDULED',
  distanceKm: 1300,
  durationMinutes: 180,
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

test('a poll that learned nothing writes nothing, so the next refresh asks again', async () => {
  await insertFlight(driver, tenDaysOut);
  const nothing: FlightStatusPort = { fetchFlightStatus: async () => null };

  await refreshDueFlights(driver, nothing, NOW);

  expect((await getFlightById(driver, 'f-1'))?.lastSyncedAt).toBeNull();
});

test('one flight that cannot be synced does not stop the others or hide the list', async () => {
  await insertFlight(driver, { ...tenDaysOut, id: 'bad', depTz: 'Not/AZone' });
  await insertFlight(driver, { ...tenDaysOut, id: 'good', flightNumber: 'CI100' });
  const { port, calls } = countingPort();

  const shown = await refreshDueFlights(driver, port, NOW);

  expect(calls).toEqual(['CI100']);
  expect(shown.map((f) => f.id).sort()).toEqual(['bad', 'good']);
});

// The network takes seconds; the user can add, delete or edit in that time.
describe('while a poll is on its way', () => {
  function portDuring(work: () => Promise<void>, update = { status: 'BOARDING' as const }) {
    const port: FlightStatusPort = {
      fetchFlightStatus: async () => {
        await work();
        return update;
      },
    };
    return port;
  }

  test('an edit the user makes is not overwritten by the record read before it', async () => {
    await insertFlight(driver, tenDaysOut);
    const port = portDuring(() => updateFlight(driver, 'f-1', { seat: '24A', depGate: 'D6' }));

    await refreshDueFlights(driver, port, NOW);

    const saved = await getFlightById(driver, 'f-1');
    expect([saved?.seat, saved?.depGate, saved?.status]).toEqual(['24A', 'D6', 'BOARDING']);
  });

  test('a flight added shows up, and a flight deleted stays gone', async () => {
    await insertFlight(driver, tenDaysOut);
    await insertFlight(driver, { ...tenDaysOut, id: 'gone' });
    const port = portDuring(async () => {
      await deleteFlight(driver, 'gone');
      await insertFlight(driver, { ...tenDaysOut, id: 'new', lastSyncedAt: NOW });
    });

    const shown = await refreshDueFlights(driver, port, NOW);

    expect(shown.map((f) => f.id).sort()).toEqual(['f-1', 'new']);
  });
});

test('saveSyncedFlight writes only what the sync changed', async () => {
  await insertFlight(driver, tenDaysOut);
  await updateFlight(driver, 'f-1', { notes: 'typed meanwhile' });

  await saveSyncedFlight(driver, tenDaysOut, { ...tenDaysOut, depGate: 'B7' });

  const saved = await getFlightById(driver, 'f-1');
  expect([saved?.notes, saved?.depGate]).toEqual(['typed meanwhile', 'B7']);
});
