import { beforeEach, describe, expect, test } from 'vitest';
import { createNodeDriver } from './testing/nodeDriver';
import { SCHEMA_VERSION, migrate } from './schema';
import type { SqlDriver } from './driver';

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
});

async function tableNames(): Promise<string[]> {
  const rows = await driver.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

describe('migrate', () => {
  test('creates every table the spec calls for', async () => {
    await migrate(driver);

    expect(await tableNames()).toEqual([
      'achievements',
      'fog_tiles',
      'meta',
      'points',
      'rejections',
      'segments',
      'tile_places',
    ]);
  });

  test('records the schema version it applied', async () => {
    await migrate(driver);

    const row = await driver.get<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      ['schema_version'],
    );

    expect(row?.value).toBe(String(SCHEMA_VERSION));
  });

  test('is safe to run again on an already migrated database', async () => {
    await migrate(driver);
    await driver.run('INSERT INTO segments (started_at) VALUES (?)', [1]);

    await migrate(driver);

    const row = await driver.get<{ count: number }>('SELECT COUNT(*) AS count FROM segments');
    expect(row?.count).toBe(1);
  });
});

describe('rejections table', () => {
  test('stores the reason without ever storing a coordinate', async () => {
    await migrate(driver);

    const columns = await driver.all<{ name: string }>('PRAGMA table_info(rejections)');
    const names = columns.map((c) => c.name);

    expect(names).toContain('reason');
    expect(names).not.toContain('lat');
    expect(names).not.toContain('lon');
  });
});

describe('fog_tiles table', () => {
  test('round-trips a bitmap blob unchanged', async () => {
    await migrate(driver);
    const bitmap = new Uint8Array(2048);
    bitmap[0] = 0b1010_0101;
    bitmap[2047] = 0xff;

    await driver.run(
      'INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (?, ?, ?, ?, ?)',
      [16, 54898, 27983, bitmap, 1],
    );
    const row = await driver.get<{ bitmap: Uint8Array }>(
      'SELECT bitmap FROM fog_tiles WHERE z = ? AND x = ? AND y = ?',
      [16, 54898, 27983],
    );

    expect(row?.bitmap).toHaveLength(2048);
    expect(row?.bitmap[0]).toBe(0b1010_0101);
    expect(row?.bitmap[2047]).toBe(0xff);
  });

  test('keeps one row per tile coordinate', async () => {
    await migrate(driver);
    const insert = () =>
      driver.run(
        'INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (?, ?, ?, ?, ?)',
        [16, 1, 2, new Uint8Array(2048), 1],
      );

    await insert();

    await expect(insert()).rejects.toThrow();
  });
});

describe('points table', () => {
  test('refuses a point that belongs to no segment', async () => {
    await migrate(driver);

    await expect(
      driver.run(
        'INSERT INTO points (segment_id, ts, lat, lon, accuracy) VALUES (?, ?, ?, ?, ?)',
        [999, 1, 25.0, 121.0, 8],
      ),
    ).rejects.toThrow();
  });
});
