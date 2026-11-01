/**
 * Wraps a SqlDriver and remembers what it was asked.
 *
 * Test-only. The queries worth counting here are the ones that read the whole
 * track: a cache that holds finished answers still lets two callers who arrive
 * together each run the scan, and nothing but counting the scans shows it.
 */

import type { SqlDriver } from '../driver';

export interface CountingDriver extends SqlDriver {
  /** Every statement issued, in order. */
  readonly queries: string[];
  /** Rows handed back by all() and get() so far: what a scan actually cost. */
  readonly rowsRead: number;
  /** Make the next read (all or get) fail once. */
  failNextRead(error: Error): void;
}

export function countingDriver(inner: SqlDriver): CountingDriver {
  const queries: string[] = [];
  let rowsRead = 0;
  let pendingFailure: Error | null = null;

  const record = (sql: string) => {
    queries.push(sql);
  };

  const maybeFail = async () => {
    if (pendingFailure) {
      const error = pendingFailure;
      pendingFailure = null;
      throw error;
    }
  };

  return {
    queries,
    get rowsRead() {
      return rowsRead;
    },
    failNextRead(error) {
      pendingFailure = error;
    },
    async exec(sql) {
      record(sql);
      return inner.exec(sql);
    },
    async run(sql, params) {
      record(sql);
      return inner.run(sql, params);
    },
    async all<T>(sql: string, params?: Parameters<SqlDriver['all']>[1]) {
      record(sql);
      await maybeFail();
      const rows = await inner.all<T>(sql, params);
      rowsRead += rows.length;
      return rows;
    },
    async get<T>(sql: string, params?: Parameters<SqlDriver['get']>[1]) {
      record(sql);
      await maybeFail();
      const row = await inner.get<T>(sql, params);
      if (row !== undefined) rowsRead += 1;
      return row;
    },
    close: () => inner.close(),
  };
}
