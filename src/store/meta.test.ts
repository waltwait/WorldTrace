import { beforeEach, describe, expect, test } from 'vitest';
import type { SqlDriver } from './driver';
import { readMeta, readMetaNumber, writeMeta } from './meta';
import { migrate, SCHEMA_VERSION } from './schema';
import { createNodeDriver } from './testing/nodeDriver';

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
});

describe('meta', () => {
  test('is null for a key that was never written', async () => {
    expect(await readMeta(driver, 'last_backup_at')).toBeNull();
  });

  test('reads back what was written', async () => {
    await writeMeta(driver, 'last_backup_file_id', 'abc123');

    expect(await readMeta(driver, 'last_backup_file_id')).toBe('abc123');
  });

  test('overwrites rather than piling up rows', async () => {
    await writeMeta(driver, 'last_backup_at', '1');
    await writeMeta(driver, 'last_backup_at', '2');

    expect(await readMeta(driver, 'last_backup_at')).toBe('2');
  });

  test('reads a number back as a number', async () => {
    await writeMeta(driver, 'last_backup_at', String(1_754_000_000_000));

    expect(await readMetaNumber(driver, 'last_backup_at')).toBe(1_754_000_000_000);
  });

  test('is null rather than NaN for a number that was never written', async () => {
    expect(await readMetaNumber(driver, 'last_backup_at')).toBeNull();
  });

  test('is null rather than NaN for a value that is not a number', async () => {
    // A corrupted row must not turn into a NaN timestamp, which would compare
    // false against everything and silently disable the backup schedule.
    await writeMeta(driver, 'last_backup_at', 'not-a-number');

    expect(await readMetaNumber(driver, 'last_backup_at')).toBeNull();
  });

  test('does not disturb the schema version the migration wrote', async () => {
    await writeMeta(driver, 'last_backup_at', '1');

    expect(await readMeta(driver, 'schema_version')).toBe(String(SCHEMA_VERSION));
  });
});
