import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { runRecorderLoop, type RecorderLoopDeps, type LoopStatus } from './recorderLoop';

/** A promise the test settles by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class Denied extends Error {}

function setup(overrides: Partial<RecorderLoopDeps<string, string>> = {}) {
  const snapshots: string[] = [];
  const statuses: Array<{ status: LoopStatus; error?: string }> = [];
  const warnings: unknown[] = [];

  const deps: RecorderLoopDeps<string, string> = {
    open: async () => 'driver',
    start: async () => {},
    read: async () => 'snapshot',
    isDenied: (error) => error instanceof Denied,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onStatus: (status, error) => statuses.push({ status, error }),
    onReadError: (error) => warnings.push(error),
    intervalMs: 3000,
    ...overrides,
  };

  return { deps, snapshots, statuses, warnings };
}

/** Let every promise already settled run its continuations. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('runRecorderLoop', () => {
  test('shows the recorded history without waiting for recording to start', async () => {
    const start = deferred();
    const { deps, snapshots } = setup({ start: () => start.promise });

    runRecorderLoop(deps);
    await flush();

    expect(snapshots).toEqual(['snapshot']);
  });

  test('reads while recording starts, not after', async () => {
    const order: string[] = [];
    const { deps } = setup({
      start: async () => {
        order.push('start');
      },
      read: async () => {
        order.push('read');
        return 'snapshot';
      },
    });

    runRecorderLoop(deps);
    await flush();

    expect(order.sort()).toEqual(['read', 'start']);
  });

  test('reports recording once it has started', async () => {
    const { deps, statuses } = setup();

    runRecorderLoop(deps);
    await flush();

    expect(statuses).toEqual([{ status: 'recording', error: undefined }]);
  });

  test('still shows the history when permission is refused', async () => {
    const { deps, snapshots, statuses } = setup({
      start: async () => {
        throw new Denied('no location');
      },
    });

    runRecorderLoop(deps);
    await flush();

    expect(snapshots).toEqual(['snapshot']);
    expect(statuses).toEqual([{ status: 'denied', error: 'no location' }]);
  });

  test('reports a failure to start as a failure, not a refusal', async () => {
    const { deps, statuses } = setup({
      start: async () => {
        throw new Error('task manager is unavailable');
      },
    });

    runRecorderLoop(deps);
    await flush();

    expect(statuses).toEqual([{ status: 'failed', error: 'task manager is unavailable' }]);
  });

  test('reports a database that will not open', async () => {
    const { deps, statuses, snapshots } = setup({
      open: async () => {
        throw new Error('cannot open');
      },
    });

    runRecorderLoop(deps);
    await flush();

    expect(snapshots).toEqual([]);
    expect(statuses).toEqual([{ status: 'failed', error: 'cannot open' }]);
  });

  test('reports a first read that fails', async () => {
    const { deps, statuses } = setup({
      read: async () => {
        throw new Error('corrupt');
      },
    });

    runRecorderLoop(deps);
    await flush();

    expect(statuses.at(-1)).toEqual({ status: 'failed', error: 'corrupt' });
  });

  test('reads again on every interval once recording', async () => {
    const read = vi.fn(async () => 'snapshot');
    const { deps, snapshots } = setup({ read });

    runRecorderLoop(deps);
    await flush();
    expect(read).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);

    expect(read).toHaveBeenCalledTimes(3);
    expect(snapshots).toHaveLength(3);
  });

  test('does not poll when recording could not start', async () => {
    const read = vi.fn(async () => 'snapshot');
    const { deps } = setup({
      read,
      start: async () => {
        throw new Denied('no');
      },
    });

    runRecorderLoop(deps);
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(read).toHaveBeenCalledTimes(1);
  });

  test('skips a tick while the last read is still going', async () => {
    const slow = deferred<string>();
    let calls = 0;
    const { deps } = setup({
      read: () => {
        calls++;
        return calls === 2 ? slow.promise : Promise.resolve('snapshot');
      },
    });

    runRecorderLoop(deps);
    await flush();

    await vi.advanceTimersByTimeAsync(3000); // the slow read begins
    await vi.advanceTimersByTimeAsync(3000); // would overlap: skipped
    await vi.advanceTimersByTimeAsync(3000); // would overlap: skipped
    expect(calls).toBe(2);

    slow.resolve('late');
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(3);
  });

  test('keeps polling after a read fails, and says so', async () => {
    let calls = 0;
    const { deps, warnings, snapshots } = setup({
      read: async () => {
        calls++;
        if (calls === 2) throw new Error('database is locked');
        return 'snapshot';
      },
    });

    runRecorderLoop(deps);
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);

    expect(warnings).toHaveLength(1);
    expect(snapshots).toHaveLength(2);
  });

  test('says nothing more once stopped', async () => {
    const read = deferred<string>();
    const start = deferred();
    const { deps, snapshots, statuses } = setup({
      read: () => read.promise,
      start: () => start.promise,
    });

    const loop = runRecorderLoop(deps);
    await flush();
    loop.stop();

    read.resolve('too late');
    start.resolve();
    await flush();

    expect(snapshots).toEqual([]);
    expect(statuses).toEqual([]);
  });

  test('stops polling once stopped', async () => {
    const read = vi.fn(async () => 'snapshot');
    const { deps } = setup({ read });

    const loop = runRecorderLoop(deps);
    await flush();
    loop.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(read).toHaveBeenCalledTimes(1);
  });

  test('stops polling when stopped before recording had started', async () => {
    const start = deferred();
    const read = vi.fn(async () => 'snapshot');
    const { deps } = setup({ read, start: () => start.promise });

    const loop = runRecorderLoop(deps);
    await flush();
    loop.stop();
    start.resolve();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(read).toHaveBeenCalledTimes(1);
  });
});
