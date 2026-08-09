/**
 * The narrow SQL port the store speaks through.
 *
 * On device this is backed by expo-sqlite; in tests it is backed by Node's
 * built-in SQLite. Both run the same statements, so the SQL itself is covered
 * by real execution rather than by a stand-in that only pretends to be a
 * database.
 */

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface RunResult {
  /**
   * The row id this statement inserted.
   *
   * Reported by the statement itself rather than read back afterwards with
   * `last_insert_rowid()`, which is a property of the *connection*: any other
   * insert landing in between would answer instead, and the caller would go on
   * to use a row id belonging to a different table.
   */
  lastInsertRowId: number;
  changes: number;
}

export interface SqlDriver {
  /** Run one or more statements with no parameters. */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<RunResult>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  /**
   * Release the underlying file.
   *
   * Needed before the database file is replaced: an open connection to a file
   * that has been swapped underneath it does not fail loudly, it starts
   * refusing writes.
   */
  close(): Promise<void>;
}
