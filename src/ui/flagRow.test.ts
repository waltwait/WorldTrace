import { describe, expect, test } from 'vitest';
import { flagRow } from './flagRow';

describe('flagRow', () => {
  test('shows every flag that fits', () => {
    expect(flagRow(['JP', 'TH', 'VN'], 7)).toEqual({ codes: ['JP', 'TH', 'VN'], more: 0 });
    expect(flagRow(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 7)).toEqual({
      codes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      more: 0,
    });
  });

  // The count takes a flag's room: seven and "+3" would not fit where seven flags do.
  test('gives the last place to how many more there are', () => {
    expect(flagRow(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 7)).toEqual({
      codes: ['A', 'B', 'C', 'D', 'E', 'F'],
      more: 2,
    });
  });

  test('of nothing is empty', () => {
    expect(flagRow([], 7)).toEqual({ codes: [], more: 0 });
  });
});
