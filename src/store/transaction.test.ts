import { beforeEach, describe, expect, test } from 'vitest';
import type { FlightRecord } from '../flights/types';
import type { SqlDriver } from './driver';
import { insertFlight, listFlights } from './flights';
import { migrate } from './schema';
import { createNodeDriver } from './testing/nodeDriver';

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
  await driver.exec('CREATE TABLE notes (text TEXT NOT NULL)');
});

describe('transaction', () => {
  test('keeps what the work wrote when it succeeds, and hands back its answer', async () => {
    const answer = await driver.transaction(async (tx) => {
      await tx.run(`INSERT INTO notes VALUES ('kept')`);
      return 42;
    });
    expect(answer).toBe(42);
    expect(await driver.all('SELECT text FROM notes')).toEqual([{ text: 'kept' }]);
  });

  test('undoes everything the work wrote when it fails, and says why', async () => {
    await expect(
      driver.transaction(async (tx) => {
        await tx.run(`INSERT INTO notes VALUES ('gone')`);
        throw new Error('halfway');
      }),
    ).rejects.toThrow('halfway');
    expect(await driver.all('SELECT text FROM notes')).toEqual([]);
  });
});

const flight: FlightRecord = {
  id: 'f-1',
  flightNumber: 'BR198',
  depDate: '2026-12-01',
  scheduleSource: 'api',
  airlineCode: 'BR',
  airlineName: 'EVA Air',
  depIata: 'TPE',
  arrIata: 'NRT',
  depScheduledUtc: 1,
  arrScheduledUtc: 2,
  depTz: 'Asia/Taipei',
  arrTz: 'Asia/Tokyo',
  status: 'SCHEDULED',
  distanceKm: 2100,
  durationMinutes: 180,
  isFinished: false,
  createdAt: 0,
};

// A flight is three rows and the list joins all three: one written without
// the others, because the app was killed between them, is a flight nobody
// can see again. A catch cannot clean up after a process that died.
test('a flight\'s three rows are written in one transaction', async () => {
  const inside: string[] = [];
  const outside: string[] = [];
  const watched: SqlDriver = {
    ...driver,
    run: (sql, params) => {
      outside.push(sql);
      return driver.run(sql, params);
    },
    transaction: (work) =>
      driver.transaction((tx) =>
        work({
          ...tx,
          run: (sql, params) => {
            inside.push(sql);
            return tx.run(sql, params);
          },
        }),
      ),
  };

  await insertFlight(watched, flight);

  expect(outside.filter((sql) => sql.includes('INSERT'))).toEqual([]);
  expect(inside.filter((sql) => sql.includes('INSERT'))).toHaveLength(3);
  expect((await listFlights(driver)).map((f) => f.id)).toEqual(['f-1']);
});
