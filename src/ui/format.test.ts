import { describe, expect, test } from 'vitest';
import { formatArea, formatDistance, formatByUnit, rejectionLabel } from './format';

describe('formatByUnit', () => {
  test('writes a distance in kilometres', () => {
    expect(formatByUnit(1_430, 'distance')).toBe('1.43 km');
  });

  test('writes an area in square kilometres', () => {
    expect(formatByUnit(58_000, 'area')).toBe('0.0580 km²');
  });

  test('writes a plain count with no unit at all', () => {
    // These are days, tiles and outings — a unit here would just be noise
    // beside a label that already says which.
    expect(formatByUnit(7, 'count')).toBe('7');
  });

  test('groups a large count so it stays readable', () => {
    expect(formatByUnit(1_500, 'count')).toBe('1,500');
  });

  test('rounds a count rather than showing a fraction of a day', () => {
    expect(formatByUnit(2.6, 'count')).toBe('3');
  });
});

describe('formatArea', () => {
  test('is always in square kilometres, matching the distance readout', () => {
    expect(formatArea(1_000_000)).toBe('1.00 km²');
    expect(formatArea(12_340_000)).toBe('12.34 km²');
  });

  test('keeps four decimals while the area is still small', () => {
    // A single brush disc is around 2,800 m². Two decimals would leave the
    // number frozen at 0.00 for the first few walks.
    expect(formatArea(3837)).toBe('0.0038 km²');
    expect(formatArea(842_150)).toBe('0.8422 km²');
  });

  test('shows a zero rather than an empty panel', () => {
    expect(formatArea(0)).toBe('0.0000 km²');
  });

  test('groups thousands once the area gets serious', () => {
    expect(formatArea(36_197_000_000)).toBe('36,197.00 km²');
  });
});

describe('formatDistance', () => {
  test('is always in kilometres, so the number never changes units on you', () => {
    expect(formatDistance(820)).toBe('0.82 km');
    expect(formatDistance(1000)).toBe('1.00 km');
    expect(formatDistance(12_430)).toBe('12.43 km');
  });

  test('keeps two decimals, so a short walk still moves the number', () => {
    expect(formatDistance(46)).toBe('0.05 km');
  });

  test('shows a zero before you have walked anywhere', () => {
    expect(formatDistance(0)).toBe('0.00 km');
  });

  test('groups thousands once the distance gets serious', () => {
    expect(formatDistance(1_234_560)).toBe('1,234.56 km');
  });
});

describe('rejectionLabel', () => {
  test('describes a mocked fix in words, not an enum name', () => {
    expect(rejectionLabel('MOCK_PROVIDER')).toBe('模擬定位');
  });

  test('has a label for every reason the gatekeeper can give', () => {
    const reasons = [
      'MOCK_PROVIDER',
      'MOCK_APP_ENABLED',
      'LOW_ACCURACY',
      'TIME_ANOMALY',
      'TELEPORT',
      'IMPOSSIBLE_ACCEL',
    ] as const;

    for (const reason of reasons) {
      const label = rejectionLabel(reason);
      expect(label).not.toBe(reason);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test('falls back to the raw reason if one is ever added without a label', () => {
    expect(rejectionLabel('SOMETHING_NEW' as never)).toBe('SOMETHING_NEW');
  });
});
