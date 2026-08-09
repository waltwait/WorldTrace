/**
 * A SqlDriver backed by Node's built-in SQLite.
 *
 * Test-only: it lets the store's real SQL run against a real database off
 * device, so schema and query bugs surface in `npm test` rather than on a
 * phone. Never imported by app code.
 */

import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, SqlValue } from '../driver';

export function createNodeDriver(path = ':memory:'): SqlDriver {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');

  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...(params as SqlValue[]));
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async get<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    async close() {
      db.close();
    },
  };
}
