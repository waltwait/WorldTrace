import { describe, expect, test } from 'vitest';
import { databaseFileNames } from './databaseFiles';

describe('databaseFileNames', () => {
  test('starts with the database itself', () => {
    expect(databaseFileNames('worldtrace.db')[0]).toBe('worldtrace.db');
  });

  test('includes the write-ahead log', () => {
    // Replacing the database while its -wal is left behind leaves SQLite
    // holding a journal that describes a file that no longer exists. On device
    // that surfaced as "attempt to write a readonly database", and every fix
    // after a restore was silently dropped.
    expect(databaseFileNames('worldtrace.db')).toContain('worldtrace.db-wal');
  });

  test('includes the shared-memory index', () => {
    expect(databaseFileNames('worldtrace.db')).toContain('worldtrace.db-shm');
  });

  test('includes the rollback journal, for a database not in WAL mode', () => {
    expect(databaseFileNames('worldtrace.db')).toContain('worldtrace.db-journal');
  });

  test('lists every sidecar, so none is left pointing at the replaced file', () => {
    expect(databaseFileNames('worldtrace.db')).toHaveLength(4);
  });

  test('works for any database name', () => {
    expect(databaseFileNames('other.db')).toEqual([
      'other.db',
      'other.db-wal',
      'other.db-shm',
      'other.db-journal',
    ]);
  });
});
