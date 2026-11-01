import { describe, expect, test } from 'vitest';
import { migrate } from '../store/schema';
import { createNodeDriver } from '../store/testing/nodeDriver';
import { readSnapshot, sameRejections, type CacheState } from './recorderSnapshot';

describe('readSnapshot', () => {
  test('delivers tiles via onPartial before recomputing distance on first read', async () => {
    const driver = createNodeDriver(':memory:');
    await migrate(driver);

    const cache: CacheState = {
      fogSignature: null,
      pointsSignature: null,
      tiles: [],
      exploredSquareMeters: 0,
      distanceMeters: 0,
    };

    const partials: Array<{ tiles: unknown[]; distanceMeters: number }> = [];
    const final = await readSnapshot(driver, cache, (partial) => {
      partials.push({ tiles: partial.tiles, distanceMeters: partial.distanceMeters });
    });

    expect(partials).toHaveLength(1);
    expect(partials[0].tiles).toEqual([]);
    expect(partials[0].distanceMeters).toBe(0);
    expect(final.tiles).toEqual([]);
    expect(final.distanceMeters).toBe(0);
  });

  test('does not fire onPartial if points did not change', async () => {
    const driver = createNodeDriver(':memory:');
    await migrate(driver);

    const cache: CacheState = {
      fogSignature: { count: 0, lastUpdated: null },
      pointsSignature: { count: 0, lastTs: null },
      tiles: [],
      exploredSquareMeters: 0,
      distanceMeters: 100,
    };

    const partials: unknown[] = [];
    const final = await readSnapshot(driver, cache, (partial) => {
      partials.push(partial);
    });

    expect(partials).toHaveLength(0);
    expect(final.distanceMeters).toBe(100);
  });

  test('sameRejections compares correctly', () => {
    expect(sameRejections([], [])).toBe(true);
    expect(
      sameRejections(
        [{ reason: 'MOCK_PROVIDER', count: 1, lastAt: 100 }],
        [{ reason: 'MOCK_PROVIDER', count: 1, lastAt: 100 }],
      ),
    ).toBe(true);
    expect(
      sameRejections(
        [{ reason: 'MOCK_PROVIDER', count: 1, lastAt: 100 }],
        [{ reason: 'MOCK_PROVIDER', count: 2, lastAt: 100 }],
      ),
    ).toBe(false);
  });
});
