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
  /** Make the next read (all or get) fail once. */
  failNextRead(error: Error): void;
}

export function countingDriver(inner: SqlDriver): CountingDriver {
  const queries: string[] = [];
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
      return inner.all<T>(sql, params);
    },
    async get<T>(sql: string, params?: Parameters<SqlDriver['get']>[1]) {
      record(sql);
      await maybeFail();
      return inner.get<T>(sql, params);
    },
    close: () => inner.close(),
  };
}
