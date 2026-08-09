/**
 * The one database connection the app shares.
 *
 * Screens each need to read, and opening a second connection to the same file
 * invites two migrations racing on first launch.
 */

import type { SqlDriver } from './driver';
import { createExpoDriver } from './expoDriver';
import { migrate } from './schema';

let instance: Promise<SqlDriver> | null = null;

export function database(): Promise<SqlDriver> {
  instance ??= (async () => {
    const driver = await createExpoDriver();
    await migrate(driver);
    return driver;
  })();

  return instance;
}

/**
 * Close the connection and forget it, so the next caller opens the file fresh.
 *
 * Has to happen *before* the database file is replaced. A connection left open
 * across a swap does not fail loudly — it goes on answering reads from a file
 * that no longer exists and refuses every write.
 */
export async function closeDatabase(): Promise<void> {
  const open = instance;
  instance = null;
  if (open === null) return;

  try {
    await (await open).close();
  } catch {
    // Already gone, or never finished opening. Either way the cache is
    // cleared, which is the part that matters.
  }
}
