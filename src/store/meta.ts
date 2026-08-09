/**
 * The `meta` table, as a key-value store.
 *
 * Small facts that belong to the database rather than to the app install —
 * when it was last backed up, which Drive file holds that backup. Kept here
 * rather than in device storage so that restoring a snapshot restores them
 * too, and a restored database does not immediately re-upload itself.
 */

import type { SqlDriver } from './driver';

export type MetaKey = 'schema_version' | 'last_backup_at' | 'last_backup_file_id';

export async function readMeta(driver: SqlDriver, key: MetaKey): Promise<string | null> {
  const row = await driver.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);

  return row?.value ?? null;
}

/**
 * A stored number, or null if it is missing or unreadable.
 *
 * Never NaN: a NaN timestamp compares false against everything, which would
 * quietly disable the backup schedule instead of failing visibly.
 */
export async function readMetaNumber(driver: SqlDriver, key: MetaKey): Promise<number | null> {
  const raw = await readMeta(driver, key);
  if (raw === null) return null;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function writeMeta(driver: SqlDriver, key: MetaKey, value: string): Promise<void> {
  await driver.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
}
