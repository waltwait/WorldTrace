/**
 * The flight tables, one for each place the data comes from, so what a person
 * confirmed never gets mixed up with what an API said:
 *
 *   flights          what the user confirmed
 *   flight_schedule  the timetable: looked up, or typed in when it could not be
 *   flight_status    what changes up to the day it flies
 *
 * Kept completely apart from points and fog_tiles, so flight data never pollutes
 * ground GPS fog-of-war. This runs on the screens' connection only: the two
 * connections migrating at once could fail, and on the background task's that
 * would stop recording without a word. It needs none of these tables.
 */

import { utcToLocal } from '../flights/zonedTime';
import type { SqlDriver, SqlValue } from './driver';

const MAIN_TABLE = (name: string) => `CREATE TABLE IF NOT EXISTS ${name} (
     id            TEXT PRIMARY KEY,
     flight_number TEXT NOT NULL,
     dep_date      TEXT NOT NULL,
     dep_time      TEXT,
     seat          TEXT,
     notes         TEXT,
     is_finished   INTEGER NOT NULL DEFAULT 0,
     created_at    INTEGER NOT NULL
   )`;

const STATEMENTS = [
  MAIN_TABLE('flights'),

  `CREATE TABLE IF NOT EXISTS flight_schedule (
     flight_id         TEXT PRIMARY KEY REFERENCES flights(id) ON DELETE CASCADE,
     source            TEXT NOT NULL,
     airline_code      TEXT NOT NULL,
     airline_name      TEXT NOT NULL,
     dep_iata          TEXT NOT NULL,
     arr_iata          TEXT NOT NULL,
     dep_scheduled_utc INTEGER NOT NULL,
     arr_scheduled_utc INTEGER NOT NULL,
     dep_tz            TEXT NOT NULL,
     arr_tz            TEXT NOT NULL,
     dep_terminal      TEXT,
     arr_terminal      TEXT,
     dep_city          TEXT,
     arr_city          TEXT,
     dep_country       TEXT,
     arr_country       TEXT,
     dep_lat           REAL,
     dep_lon           REAL,
     arr_lat           REAL,
     arr_lon           REAL,
     distance_km       REAL,
     duration_minutes  INTEGER NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_flight_schedule_dep ON flight_schedule(dep_scheduled_utc)`,

  `CREATE TABLE IF NOT EXISTS flight_status (
     flight_id         TEXT PRIMARY KEY REFERENCES flights(id) ON DELETE CASCADE,
     status            TEXT NOT NULL,
     dep_estimated_utc INTEGER,
     arr_estimated_utc INTEGER,
     dep_gate          TEXT,
     arr_gate          TEXT,
     baggage_belt      TEXT,
     last_synced_at    INTEGER
   )`,

  `CREATE TABLE IF NOT EXISTS flight_docs (
     id         TEXT PRIMARY KEY,
     flight_id  TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
     file_name  TEXT NOT NULL,
     local_uri  TEXT NOT NULL,
     mime_type  TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_flight_docs_flight_id ON flight_docs(flight_id)`,
];

const KM_PER_MILE = 1.609344;

interface OldFlight {
  id: string;
  flight_number: string;
  airline_code: string;
  airline_name: string;
  dep_iata: string;
  arr_iata: string;
  dep_scheduled_utc: number;
  dep_estimated_utc: number | null;
  arr_scheduled_utc: number;
  arr_estimated_utc: number | null;
  dep_tz: string;
  arr_tz: string;
  dep_terminal: string | null;
  arr_terminal: string | null;
  dep_gate: string | null;
  arr_gate: string | null;
  baggage_belt: string | null;
  status: string;
  distance_miles: number;
  duration_minutes: number;
  seat: string | null;
  notes: string | null;
  is_finished: number;
  last_synced_at: number | null;
  created_at: number;
}

function insert(driver: SqlDriver, table: string, row: Record<string, SqlValue>) {
  const columns = Object.keys(row);
  return driver.run(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row),
  );
}

async function moveRow(driver: SqlDriver, old: OldFlight): Promise<void> {
  const departure = utcToLocal(old.dep_scheduled_utc, old.dep_tz);

  await insert(driver, 'flights_moved', {
    id: old.id,
    flight_number: old.flight_number,
    dep_date: departure.date,
    dep_time: departure.time,
    seat: old.seat,
    notes: old.notes,
    is_finished: old.is_finished,
    created_at: old.created_at,
  });
  await insert(driver, 'flight_schedule', {
    flight_id: old.id,
    // It was typed in, or a ticket was read: nothing looked it up.
    source: 'user',
    airline_code: old.airline_code,
    airline_name: old.airline_name,
    dep_iata: old.dep_iata,
    arr_iata: old.arr_iata,
    dep_scheduled_utc: old.dep_scheduled_utc,
    arr_scheduled_utc: old.arr_scheduled_utc,
    dep_tz: old.dep_tz,
    arr_tz: old.arr_tz,
    dep_terminal: old.dep_terminal,
    arr_terminal: old.arr_terminal,
    distance_km: old.distance_miles * KM_PER_MILE,
    duration_minutes: old.duration_minutes,
  });
  await insert(driver, 'flight_status', {
    flight_id: old.id,
    status: old.status,
    dep_estimated_utc: old.dep_estimated_utc,
    arr_estimated_utc: old.arr_estimated_utc,
    dep_gate: old.dep_gate,
    arr_gate: old.arr_gate,
    baggage_belt: old.baggage_belt,
    last_synced_at: old.last_synced_at,
  });
}

/**
 * The first version was one table with everything in it, a booking code too.
 *
 * Foreign keys go off first: dropping a parent table deletes its rows, and with
 * them every attached document. The new main table is built under another name
 * and renamed onto the old one, which is the order SQLite documents, because
 * renaming the old one away would drag flight_docs' reference along with it.
 */
async function moveOldFlights(driver: SqlDriver): Promise<void> {
  const isOld = await driver.get(`SELECT 1 FROM pragma_table_info('flights') WHERE name = 'dep_iata'`);
  if (!isOld) return;

  await driver.exec('PRAGMA foreign_keys = OFF');
  try {
    await driver.exec('BEGIN IMMEDIATE');
    try {
      await driver.exec(MAIN_TABLE('flights_moved'));
      for (const statement of STATEMENTS.slice(1)) await driver.exec(statement);

      for (const old of await driver.all<OldFlight>('SELECT * FROM flights')) {
        await moveRow(driver, old);
      }

      await driver.exec('DROP TABLE flights');
      await driver.exec('ALTER TABLE flights_moved RENAME TO flights');
      await driver.exec('COMMIT');
    } catch (err) {
      await driver.exec('ROLLBACK');
      throw err;
    }
  } finally {
    await driver.exec('PRAGMA foreign_keys = ON');
  }
}

export async function migrateFlights(driver: SqlDriver): Promise<void> {
  await moveOldFlights(driver);
  for (const statement of STATEMENTS) await driver.exec(statement);
}
