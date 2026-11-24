import { describe, expect, test, vi } from 'vitest';
import { oneAtATime } from './oneAtATime';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('oneAtATime', () => {
  // A pull on 航班 during the launch refresh ran the same polls again, each
  // a paid call, and the first to finish stopped the spinner of the other.
  test('a call while one is running joins it instead of running again', async () => {
    const gate = deferred<string>();
    const work = vi.fn(() => gate.promise);
    const run = oneAtATime(work);

    const first = run();
    const second = run();
    gate.resolve('done');

    expect(await first).toBe('done');
    expect(await second).toBe('done');
    expect(work).toHaveBeenCalledTimes(1);
  });

  test('runs again once the last run has finished', async () => {
    const work = vi.fn(async () => 'done');
    const run = oneAtATime(work);

    await run();
    await run();

    expect(work).toHaveBeenCalledTimes(2);
  });

  test('a failed run is not kept: the next call tries again', async () => {
    const gate = deferred<string>();
    const work = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValueOnce('ok');
    const run = oneAtATime(work);

    const failed = run();
    gate.reject(new Error('offline'));
    await expect(failed).rejects.toThrow('offline');

    await expect(run()).resolves.toBe('ok');
  });
});
