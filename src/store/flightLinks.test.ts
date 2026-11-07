import { beforeEach, describe, expect, test } from 'vitest';
import type { FlightRecord } from '../flights/types';
import type { SqlDriver } from './driver';
import { deleteFlightLink, insertFlightLink, listFlightLinks, moveFlightLinks } from './flightLinks';
import { deleteFlight, insertFlight } from './flights';
import { migrate } from './schema';
import { createNodeDriver } from './testing/nodeDriver';

let driver: SqlDriver;

const flight = (id: string): FlightRecord => ({
  id,
  flightNumber: 'XX100',
  depDate: '2026-07-01',
  scheduleSource: 'api',
  airlineCode: 'XX',
  airlineName: 'Example Air',
  depIata: 'TPE',
  arrIata: 'NRT',
  depScheduledUtc: 1,
  arrScheduledUtc: 2,
  depTz: 'Asia/Taipei',
  arrTz: 'Asia/Tokyo',
  status: 'LANDED',
  durationMinutes: 180,
  isFinished: true,
  createdAt: 0,
});

const plan = { id: 'l1', flightId: 'f1', url: 'https://example.com/plan', title: '行程表', createdAt: 5 };

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
  await insertFlight(driver, flight('f1'));
  await insertFlight(driver, flight('f2'));
});

describe('flight links', () => {
  test('come back as they were kept, oldest first', async () => {
    const stay = { id: 'l2', flightId: 'f2', url: 'https://example.com/stay', title: null, createdAt: 3 };
    await insertFlightLink(driver, plan);
    await insertFlightLink(driver, stay);

    expect(await listFlightLinks(driver)).toEqual([stay, plan]);
  });

  test('can be deleted one at a time', async () => {
    await insertFlightLink(driver, plan);
    await deleteFlightLink(driver, 'l1');

    expect(await listFlightLinks(driver)).toEqual([]);
  });

  test('go with their flight', async () => {
    await insertFlightLink(driver, plan);
    await deleteFlight(driver, 'f1');

    expect(await listFlightLinks(driver)).toEqual([]);
  });

  test('can move to another flight of the trip', async () => {
    await insertFlightLink(driver, plan);
    await moveFlightLinks(driver, 'f1', 'f2');
    await deleteFlight(driver, 'f1');

    expect(await listFlightLinks(driver)).toEqual([{ ...plan, flightId: 'f2' }]);
  });

  test('cannot belong to a flight that is not there', async () => {
    await expect(insertFlightLink(driver, { ...plan, flightId: 'gone' })).rejects.toThrow(/FOREIGN KEY/);
  });
});
