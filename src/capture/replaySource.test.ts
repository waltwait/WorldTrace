import { describe, expect, test, vi } from 'vitest';
import type { Fix } from '../gatekeeper/gatekeeper';
import { createReplaySource } from './replaySource';

function track(count: number): Fix[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: 25.033,
    lon: 121.5654 + i * 0.0001,
    accuracy: 8,
    timestamp: Date.UTC(2026, 7, 2, 9, 0, i),
    mocked: false,
  }));
}

describe('createReplaySource', () => {
  test('emits every fix in order', async () => {
    const fixes = track(4);
    const source = createReplaySource(fixes, { sleep: async () => {} });
    const seen: number[] = [];

    await source.start((fix) => {
      seen.push(fix.timestamp);
    });

    expect(seen).toEqual(fixes.map((f) => f.timestamp));
  });

  test('waits for a slow consumer before emitting the next fix', async () => {
    const source = createReplaySource(track(3), { sleep: async () => {} });
    let inFlight = 0;
    let overlapped = false;

    await source.start(async () => {
      inFlight++;
      if (inFlight > 1) overlapped = true;
      await Promise.resolve();
      inFlight--;
    });

    expect(overlapped).toBe(false);
  });

  test('stops emitting once stopped', async () => {
    const source = createReplaySource(track(10), { sleep: async () => {} });
    const seen: Fix[] = [];

    await source.start(async (fix) => {
      seen.push(fix);
      if (seen.length === 3) await source.stop();
    });

    expect(seen).toHaveLength(3);
  });

  test('paces emissions with the configured interval', async () => {
    const sleep = vi.fn(async () => {});
    const source = createReplaySource(track(3), { intervalMs: 250, sleep });

    await source.start(() => {});

    expect(sleep).toHaveBeenCalledWith(250);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  test('does nothing with an empty track', async () => {
    const source = createReplaySource([], { sleep: async () => {} });
    const onFix = vi.fn();

    await source.start(onFix);

    expect(onFix).not.toHaveBeenCalled();
  });
});
