import { describe, expect, test } from 'vitest';
import type { SqlDriver } from './driver';
import { sharedConnection } from './sharedConnection';

function fakeDriver(log: string[], name: string): SqlDriver {
  return {
    exec: async () => {},
    run: async () => ({ lastInsertRowId: 0, changes: 0 }),
    all: async () => [],
    get: async () => undefined,
    close: async () => {
      log.push(`close ${name}`);
    },
  };
}

/** Opens drivers named 1, 2, …; `prepare` fails while `failing` says so. */
function opener() {
  const log: string[] = [];
  let opened = 0;
  let failing = false;
  const connection = sharedConnection(
    async () => {
      opened += 1;
      log.push(`open ${opened}`);
      return fakeDriver(log, String(opened));
    },
    async () => {
      if (failing) throw new Error('database is locked');
    },
  );
  return {
    connection,
    log,
    fail(on: boolean) {
      failing = on;
    },
  };
}

describe('sharedConnection', () => {
  test('two callers at once share one opening', async () => {
    const { connection, log } = opener();
    const [a, b] = await Promise.all([connection.get(), connection.get()]);
    expect(a).toBe(b);
    expect(log).toEqual(['open 1']);
  });

  // A migration that fails once, say on a write lock the background task
  // held, used to leave every screen without a database until a restart.
  test('a failed opening is forgotten, so the next caller tries again', async () => {
    const { connection, fail } = opener();
    fail(true);
    await expect(connection.get()).rejects.toThrow('database is locked');

    fail(false);
    await expect(connection.get()).resolves.toBeDefined();
  });

  test('a connection that failed to prepare is closed, not left open', async () => {
    const { connection, log, fail } = opener();
    fail(true);
    await connection.get().catch(() => {});
    expect(log).toEqual(['open 1', 'close 1']);
  });

  test('close forgets the connection, so the next caller opens the file fresh', async () => {
    const { connection, log } = opener();
    await connection.get();
    await connection.close();
    await connection.get();
    expect(log).toEqual(['open 1', 'close 1', 'open 2']);
  });

  test('closing after a failed opening does not throw', async () => {
    const { connection, fail } = opener();
    fail(true);
    const failed = connection.get();
    await expect(connection.close()).resolves.toBeUndefined();
    await expect(failed).rejects.toThrow();
  });
});
