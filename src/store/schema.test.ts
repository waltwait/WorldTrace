import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { createNodeDriver } from './testing/nodeDriver';
import { deleteFlight, getFlightById, insertFlight, listFlightDocs } from './flights';
import { SCHEMA_VERSION, migrate, migrateTrack } from './schema';
import type { SqlDriver } from './driver';

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
});

async function tableNames(): Promise<string[]> {
  const rows = await driver.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

describe('migrate', () => {
  test('creates every table the spec calls for', async () => {
    await migrate(driver);

    expect(await tableNames()).toEqual([
      'achievements',
      'flight_docs',
      'flight_schedule',
      'flight_status',
      'flights',
      'fog_tiles',
      'meta',
      'points',
      'rejections',
      'segments',
      'tile_places',
    ]);
  });

  test('records the schema version it applied', async () => {
    await migrate(driver);

    const row = await driver.get<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      ['schema_version'],
    );

    expect(row?.value).toBe(String(SCHEMA_VERSION));
  });

  test('is safe to run again on an already migrated database', async () => {
    await migrate(driver);
    await driver.run('INSERT INTO segments (started_at) VALUES (?)', [1]);

    await migrate(driver);

    const row = await driver.get<{ count: number }>('SELECT COUNT(*) AS count FROM segments');
    expect(row?.count).toBe(1);
  });
});

describe('rejections table', () => {
  test('stores the reason without ever storing a coordinate', async () => {
    await migrate(driver);

    const columns = await driver.all<{ name: string }>('PRAGMA table_info(rejections)');
    const names = columns.map((c) => c.name);

    expect(names).toContain('reason');
    expect(names).not.toContain('lat');
    expect(names).not.toContain('lon');
  });
});

describe('fog_tiles table', () => {
  test('round-trips a bitmap blob unchanged', async () => {
    await migrate(driver);
    const bitmap = new Uint8Array(2048);
    bitmap[0] = 0b1010_0101;
    bitmap[2047] = 0xff;

    await driver.run(
      'INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (?, ?, ?, ?, ?)',
      [16, 54898, 27983, bitmap, 1],
    );
    const row = await driver.get<{ bitmap: Uint8Array }>(
      'SELECT bitmap FROM fog_tiles WHERE z = ? AND x = ? AND y = ?',
      [16, 54898, 27983],
    );

    expect(row?.bitmap).toHaveLength(2048);
    expect(row?.bitmap[0]).toBe(0b1010_0101);
    expect(row?.bitmap[2047]).toBe(0xff);
  });

  test('keeps one row per tile coordinate', async () => {
    await migrate(driver);
    const insert = () =>
      driver.run(
        'INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (?, ?, ?, ?, ?)',
        [16, 1, 2, new Uint8Array(2048), 1],
      );

    await insert();

    await expect(insert()).rejects.toThrow();
  });
});

describe('points table', () => {
  test('refuses a point that belongs to no segment', async () => {
    await migrate(driver);

    await expect(
      driver.run(
        'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
        [999, 1, 25.0, 121.0, 8],
      ),
    ).rejects.toThrow();
  });
});

describe('flights and flight_docs tables', () => {
  test('cascades deletion of flight_docs when a flight is deleted', async () => {
    await migrate(driver);

    await insertFlight(driver, {
      id: 'fl-1',
      flightNumber: 'CI501',
      depDate: '2026-12-31',
      isFinished: false,
      createdAt: 1767000000000,
      scheduleSource: 'user',
      airlineCode: 'CI',
      airlineName: 'China Airlines',
      depIata: 'TPE',
      arrIata: 'PVG',
      depScheduledUtc: 1767141900000,
      arrScheduledUtc: 1767149400000,
      depTz: 'Asia/Taipei',
      arrTz: 'Asia/Shanghai',
      durationMinutes: 125,
      status: 'SCHEDULED',
    });

    await driver.run(
      'INSERT INTO flight_docs (id, flight_id, file_name, local_uri, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['doc-1', 'fl-1', 'ticket.pdf', 'file:///app/ticket.pdf', 'application/pdf', 1767000000000],
    );

    expect(await driver.get<{ count: number }>('SELECT COUNT(*) as count FROM flight_docs')).toEqual({ count: 1 });

    await driver.run('DELETE FROM flights WHERE id = ?', ['fl-1']);

    expect(await driver.get<{ count: number }>('SELECT COUNT(*) as count FROM flight_docs')).toEqual({ count: 0 });
  });
});

// The table as the first version of flights built it, with a flight in it.
async function oldFlightsDatabase(): Promise<void> {
  await driver.exec(`CREATE TABLE flights (
    id TEXT PRIMARY KEY, flight_number TEXT NOT NULL, airline_code TEXT NOT NULL,
    airline_name TEXT NOT NULL, alliance TEXT, dep_iata TEXT NOT NULL, arr_iata TEXT NOT NULL,
    dep_scheduled_utc INTEGER NOT NULL, dep_estimated_utc INTEGER,
    arr_scheduled_utc INTEGER NOT NULL, arr_estimated_utc INTEGER,
    dep_tz TEXT NOT NULL, arr_tz TEXT NOT NULL, dep_terminal TEXT, arr_terminal TEXT,
    dep_gate TEXT, arr_gate TEXT, baggage_belt TEXT, status TEXT NOT NULL DEFAULT 'SCHEDULED',
    distance_miles REAL NOT NULL, duration_minutes INTEGER NOT NULL, seat TEXT, cabin_class TEXT,
    pnr TEXT, notes TEXT, notifications_enabled INTEGER NOT NULL DEFAULT 0,
    is_finished INTEGER NOT NULL DEFAULT 0, last_synced_at INTEGER, created_at INTEGER NOT NULL
  )`);
  await driver.exec(`CREATE TABLE flight_docs (
    id TEXT PRIMARY KEY, flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL, local_uri TEXT NOT NULL, mime_type TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  await driver.run(
    `INSERT INTO flights (id, flight_number, airline_code, airline_name, dep_iata, arr_iata,
       dep_scheduled_utc, arr_scheduled_utc, dep_tz, arr_tz, dep_gate, status, distance_miles,
       duration_minutes, seat, pnr, notes, is_finished, last_synced_at, created_at)
     VALUES ('f', 'BR198', 'BR', 'EVA Air', 'TPE', 'NRT', ?, ?, 'Asia/Taipei', 'Asia/Tokyo',
       'D6', 'LANDED', 1000, 180, '24A', 'QZ7K2M', 'a note', 1, 5, 6)`,
    [Date.UTC(2026, 10, 30, 23, 30), Date.UTC(2026, 11, 1, 2, 30)],
  );
  await driver.run(
    `INSERT INTO flight_docs VALUES ('d', 'f', 'ticket.pdf', 'file:///t.pdf', 'application/pdf', 7)`,
  );
}

describe('moving flights to the three tables', () => {
  beforeEach(oldFlightsDatabase);

  test('keeps the flight, with its date on the departure airport\'s clocks', async () => {
    await migrate(driver);

    const flight = await getFlightById(driver, 'f');
    expect(flight?.flightNumber).toBe('BR198');
    expect(flight?.depDate).toBe('2026-12-01');
    expect(flight?.depTime).toBe('07:30');
    expect(flight?.seat).toBe('24A');
    expect(flight?.notes).toBe('a note');
    expect(flight?.isFinished).toBe(true);
    expect(flight?.depGate).toBe('D6');
    expect(flight?.status).toBe('LANDED');
    expect(flight?.lastSyncedAt).toBe(5);
    expect(flight?.createdAt).toBe(6);
  });

  test('turns its distance into kilometres', async () => {
    await migrate(driver);

    expect((await getFlightById(driver, 'f'))?.distanceKm).toBeCloseTo(1609.344);
  });

  test('says nobody looked it up', async () => {
    await migrate(driver);

    expect((await getFlightById(driver, 'f'))?.scheduleSource).toBe('user');
  });

  test('leaves no booking code behind, in any table', async () => {
    await migrate(driver);

    const columns = await driver.all<{ name: string }>(`SELECT name FROM pragma_table_info('flights')`);
    expect(columns.map((c) => c.name)).not.toContain('pnr');
    const tables = await driver.all<{ sql: string }>(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL`);
    expect(tables.map((t) => t.sql).join()).not.toContain('pnr');
  });

  // Dropping a parent table deletes its children when foreign keys are on.
  test('keeps the documents attached to it', async () => {
    await migrate(driver);

    expect((await listFlightDocs(driver, 'f')).map((d) => d.id)).toEqual(['d']);
  });

  test('leaves foreign keys on, so a delete still reaches the documents', async () => {
    await migrate(driver);

    await deleteFlight(driver, 'f');

    expect(await listFlightDocs(driver, 'f')).toEqual([]);
  });

  test('is safe to run again', async () => {
    await migrate(driver);
    await migrate(driver);

    expect(await getFlightById(driver, 'f')).not.toBeNull();
  });
});

// The background task opens its own connection. Changing flight tables from both
// at once could fail, and a failure there would stop recording without a word.
test('the background task runs the track migration and nothing more', () => {
  const source = readFileSync('src/capture/backgroundTask.ts', 'utf8');

  expect(source).toContain('await migrateTrack(driver)');
  expect(source).not.toMatch(/\bmigrate\(/);
});

test('the track migration does not touch the flight tables', async () => {
  await migrateTrack(driver);

  expect(await tableNames()).not.toContain('flights');
  expect(await tableNames()).toContain('points');
});
