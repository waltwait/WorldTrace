/**
 * The on-device SqlDriver, backed by expo-sqlite.
 *
 * Its counterpart in testing/nodeDriver.ts runs the same statements against
 * Node's SQLite, so schema and queries are exercised by `npm test` before they
 * ever reach a phone.
 */

import * as SQLite from 'expo-sqlite';
import type { SqlDriver, SqlValue } from './driver';

export const DATABASE_NAME = 'worldtrace.db';

/**
 * Settings that belong to a connection, not the file, so every connection
 * needs them — the transaction's own included.
 */
async function prepareConnection(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON');
  // Two connections write this file: the screens' and the background task's.
  // Without a busy timeout a write that meets the other's lock fails at once
  // with SQLITE_BUSY — on the screens' side that could be the flight
  // migration on first launch. Wait for the lock instead.
  await db.execAsync('PRAGMA busy_timeout = 5000');
}

export async function createExpoDriver(name = DATABASE_NAME): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  await prepareConnection(db);
  return adapt(db, name, false);
}

/**
 * `inTransaction` is true for a transaction's own connection: work nested
 * inside runs on it, and it is closed by the transaction, not by its user.
 */
function adapt(db: SQLite.SQLiteDatabase, name: string, inTransaction: boolean): SqlDriver {
  const driver: SqlDriver = {
    async exec(sql) {
      await db.execAsync(sql);
    },
    async run(sql, params = []) {
      const result = await db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
      return { lastInsertRowId: result.lastInsertRowId, changes: result.changes };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
    },
    async get<T>(sql: string, params: SqlValue[] = []) {
      const row = await db.getFirstAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
      return row ?? undefined;
    },
    async transaction<T>(work: (tx: SqlDriver) => Promise<T>): Promise<T> {
      if (inTransaction) return work(driver);
      // A connection of its own, so no other caller's statement lands inside
      // the transaction: withTransactionAsync shares this one and interleaves.
      // withExclusiveTransactionAsync opens its own too, but begins before
      // handing it over, and SQLite ignores `foreign_keys` inside a
      // transaction: a delete there would not cascade. So it is done by hand,
      // with the pragmas set first. IMMEDIATE takes the write lock at the
      // start, waiting for it, rather than failing to upgrade halfway.
      //
      // The work must not wait on a write of the main connection: that write
      // waits for this lock.
      const own = await SQLite.openDatabaseAsync(name, { useNewConnection: true });
      try {
        await prepareConnection(own);
        await own.execAsync('BEGIN IMMEDIATE');
        try {
          const result = await work(adapt(own, name, true));
          await own.execAsync('COMMIT');
          return result;
        } catch (err) {
          await own.execAsync('ROLLBACK');
          throw err;
        }
      } finally {
        await own.closeAsync();
      }
    },
    async close() {
      if (inTransaction) throw new Error('A transaction is closed by finishing its work.');
      await db.closeAsync();
    },
  };
  return driver;
}
