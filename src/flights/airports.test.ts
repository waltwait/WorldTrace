import { describe, expect, test } from 'vitest';
import { findAirport, getArrivalTimezoneSummary, AIRPORTS_DB } from './airports';

describe('airports', () => {
  test('finds an airport by IATA code case-insensitively', () => {
    const tpe = findAirport('TPE');
    expect(tpe).not.toBeNull();
    expect(tpe?.name).toContain('Taoyuan');
    expect(tpe?.cityZh).toBe('台北');
    expect(tpe?.countryCode).toBe('TW');
    expect(tpe?.flagEmoji).toBe('🇹🇼');
    expect(tpe?.tz).toBe('Asia/Taipei');

    const lower = findAirport('pvg');
    expect(lower).not.toBeNull();
    expect(lower?.iata).toBe('PVG');
    expect(lower?.cityZh).toBe('上海');
    expect(lower?.countryCode).toBe('CN');
  });

  test('returns null for an unknown airport', () => {
    expect(findAirport('ZZZ')).toBeNull();
    expect(findAirport('')).toBeNull();
  });

  test('contains major global and regional hubs', () => {
    const checkIatas = ['TPE', 'TSA', 'PVG', 'SHA', 'HKG', 'NRT', 'HND', 'KIX', 'SIN', 'BKK', 'ICN', 'LHR', 'CDG', 'JFK', 'LAX', 'SFO'];
    for (const iata of checkIatas) {
      expect(AIRPORTS_DB[iata]).toBeDefined();
    }
  });

  describe('getArrivalTimezoneSummary', () => {
    test('handles same timezone (e.g. Taipei to Shanghai)', () => {
      const summary = getArrivalTimezoneSummary('TPE', 'PVG');
      expect(summary.hasDifference).toBe(false);
      expect(summary.hourDifference).toBe(0);
      expect(summary.headline).toBe('No timezone change');
      expect(summary.description).toContain('same timezone');
      expect(summary.badge).toBe('UTC+8');
    });

    test('handles destination ahead (e.g. Taipei UTC+8 to Tokyo UTC+9)', () => {
      const summary = getArrivalTimezoneSummary('TPE', 'NRT');
      expect(summary.hasDifference).toBe(true);
      expect(summary.hourDifference).toBe(1);
      expect(summary.headline).toBe('1 hr ahead');
      expect(summary.badge).toBe('+1 hr');
      expect(summary.description).toContain('Tokyo is 1 hr ahead of Taipei');
    });

    test('handles destination behind (e.g. Tokyo UTC+9 to Taipei UTC+8)', () => {
      const summary = getArrivalTimezoneSummary('NRT', 'TPE');
      expect(summary.hasDifference).toBe(true);
      expect(summary.hourDifference).toBe(-1);
      expect(summary.headline).toBe('1 hr behind');
      expect(summary.badge).toBe('-1 hr');
      expect(summary.description).toContain('Taipei is 1 hr behind of Tokyo');
    });

    test('handles fallback when airport timezone is unknown', () => {
      const summary = getArrivalTimezoneSummary('UNKNOWN1', 'UNKNOWN2');
      expect(summary.hasDifference).toBe(false);
      expect(summary.hourDifference).toBe(0);
      expect(summary.headline).toBe('Timezone info unavailable');
    });
  });
});
