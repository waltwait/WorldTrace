/**
 * Database schema.
 *
 * Points and fog are stored separately on purpose. The fog bitmaps are the
 * fast path the map reads every frame; the raw points are the record of what
 * happened, kept so the fog can be recomputed from scratch when the brush
 * radius or the interpolation limits change.
 */

import type { SqlDriver } from './driver';

export const SCHEMA_VERSION = 3;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS segments (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     started_at INTEGER NOT NULL,
     ended_at   INTEGER
   )`,

  `CREATE TABLE IF NOT EXISTS points (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
     ts         INTEGER NOT NULL,
     lat        REAL NOT NULL,
     lon        REAL NOT NULL,
     accuracy   REAL NOT NULL,
     altitude   REAL,
     speed      REAL,
     heading    REAL
   )`,

  `CREATE INDEX IF NOT EXISTS points_by_time ON points (ts)`,
  `CREATE INDEX IF NOT EXISTS points_by_segment ON points (segment_id, ts)`,

  `CREATE TABLE IF NOT EXISTS fog_tiles (
     z          INTEGER NOT NULL,
     x          INTEGER NOT NULL,
     y          INTEGER NOT NULL,
     bitmap     BLOB NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (z, x, y)
   )`,

  // Deliberately has no lat/lon column. Knowing that a fix was refused is
  // useful for diagnosing an over-strict rule; keeping where it claimed to be
  // is not, and storing it would mean storing fabricated locations.
  `CREATE TABLE IF NOT EXISTS rejections (
     id       INTEGER PRIMARY KEY AUTOINCREMENT,
     ts       INTEGER NOT NULL,
     reason   TEXT NOT NULL,
     accuracy REAL
   )`,

  `CREATE INDEX IF NOT EXISTS rejections_by_time ON rejections (ts)`,

  // Only the unlock timestamp is stored. Whether an achievement is earned is
  // recomputed from the track, so changing a rule can never leave a stale
  // badge behind.
  `CREATE TABLE IF NOT EXISTS achievements (
     id          TEXT PRIMARY KEY,
     unlocked_at INTEGER NOT NULL
   )`,

  // Which country and city each explored tile sits in.
  //
  // Keyed by tile rather than by point: a z16 tile is a few hundred metres
  // across, so one lookup covers a whole neighbourhood, and the number of
  // lookups stays proportional to ground covered rather than to time spent
  // walking. Reverse geocoding needs the network and is rate-limited, so the
  // difference is the difference between "works" and "does not".
  //
  // A row with a null country is a tile that was looked up and came back with
  // nothing — the open sea, or a gap in the geocoder. Stored anyway, so it is
  // not retried forever.
  `CREATE TABLE IF NOT EXISTS tile_places (
     z           INTEGER NOT NULL,
     x           INTEGER NOT NULL,
     y           INTEGER NOT NULL,
     country     TEXT,
     city        TEXT,
     resolved_at INTEGER NOT NULL,
     PRIMARY KEY (z, x, y)
   )`,

  // Flight tracking and Flight Passport. Kept completely separate from
  // points and fog_tiles so flight data never pollutes ground GPS fog-of-war.
  `CREATE TABLE IF NOT EXISTS flights (
     id                    TEXT PRIMARY KEY,
     flight_number         TEXT NOT NULL,
     airline_code          TEXT NOT NULL,
     airline_name          TEXT NOT NULL,
     alliance              TEXT,
     dep_iata              TEXT NOT NULL,
     arr_iata              TEXT NOT NULL,
     dep_scheduled_utc     INTEGER NOT NULL,
     dep_estimated_utc     INTEGER,
     arr_scheduled_utc     INTEGER NOT NULL,
     arr_estimated_utc     INTEGER,
     dep_tz                TEXT NOT NULL,
     arr_tz                TEXT NOT NULL,
     dep_terminal          TEXT,
     arr_terminal          TEXT,
     dep_gate              TEXT,
     arr_gate              TEXT,
     baggage_belt          TEXT,
     status                TEXT NOT NULL DEFAULT 'SCHEDULED',
     distance_miles        REAL NOT NULL,
     duration_minutes      INTEGER NOT NULL,
     seat                  TEXT,
     cabin_class           TEXT,
     pnr                   TEXT,
     notes                 TEXT,
     notifications_enabled INTEGER NOT NULL DEFAULT 0,
     is_finished           INTEGER NOT NULL DEFAULT 0,
     last_synced_at        INTEGER,
     created_at            INTEGER NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_flights_dep_time ON flights(dep_scheduled_utc DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_flights_finished ON flights(is_finished, dep_scheduled_utc ASC)`,

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

/** Bring an empty or existing database up to SCHEMA_VERSION. */
export async function migrate(driver: SqlDriver): Promise<void> {
  for (const statement of STATEMENTS) {
    await driver.exec(statement);
  }

  await driver.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'schema_version',
    String(SCHEMA_VERSION),
  ]);
}
