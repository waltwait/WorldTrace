/**
 * Database schema.
 *
 * Points and fog are stored separately on purpose. The fog bitmaps are the
 * fast path the map reads every frame; the raw points are the record of what
 * happened, kept so the fog can be recomputed from scratch when the brush
 * radius or the interpolation limits change.
 */

import type { SqlDriver } from './driver';

export const SCHEMA_VERSION = 2;

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
