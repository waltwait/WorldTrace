/**
 * The one database connection the app shares.
 *
 * Screens each need to read, and opening a second connection to the same file
 * invites two migrations racing on first launch.
 */

import type { SqlDriver } from './driver';
import { createExpoDriver } from './expoDriver';
import { migrate } from './schema';
import { sharedConnection } from './sharedConnection';

const connection = sharedConnection(createExpoDriver, migrate);

export function database(): Promise<SqlDriver> {
  return connection.get();
}

/**
 * Close the connection and forget it, so the next caller opens the file fresh.
 *
 * Has to happen *before* the database file is replaced. A connection left open
 * across a swap does not fail loudly — it goes on answering reads from a file
 * that no longer exists and refuses every write.
 */
export function closeDatabase(): Promise<void> {
  return connection.close();
}
