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

export async function createExpoDriver(name = DATABASE_NAME): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA foreign_keys = ON');

  return {
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
    async close() {
      await db.closeAsync();
    },
  };
}
