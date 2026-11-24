/**
 * One connection for every caller, opened and prepared once.
 *
 * Opening is shared as a promise, so two screens asking at launch get the same
 * connection and one migration (see database.ts). The promise used to be kept
 * whatever became of it: a migration that failed once — on a write lock the
 * background task's connection held, say — left a rejected promise in place,
 * and every screen failed with it until the app was restarted. A failed
 * opening is now forgotten, the way sharedRead.ts forgets a failed read, and
 * the connection it opened is closed rather than left behind.
 */

import type { SqlDriver } from './driver';

export interface SharedConnection {
  get(): Promise<SqlDriver>;
  /** Close it and forget it, so the next `get` opens the file fresh. */
  close(): Promise<void>;
}

export function sharedConnection(
  open: () => Promise<SqlDriver>,
  prepare: (driver: SqlDriver) => Promise<void>,
): SharedConnection {
  let instance: Promise<SqlDriver> | null = null;

  return {
    get() {
      if (instance) return instance;

      const opening = (async () => {
        const driver = await open();
        try {
          await prepare(driver);
        } catch (err) {
          await driver.close().catch(() => {});
          throw err;
        }
        return driver;
      })();
      instance = opening;
      opening.catch(() => {
        if (instance === opening) instance = null;
      });
      return opening;
    },

    async close() {
      const open = instance;
      instance = null;
      if (open === null) return;
      try {
        await (await open).close();
      } catch {
        // Already gone, or never finished opening. Either way it is
        // forgotten, which is the part that matters.
      }
    },
  };
}
