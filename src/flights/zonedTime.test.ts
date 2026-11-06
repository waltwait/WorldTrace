import { describe, expect, test } from 'vitest';
import { localToUtc, offsetToZone, utcToLocal } from './zonedTime';

describe('localToUtc', () => {
  test('reads a ticket time as the time at that airport', () => {
    // 07:30 in Taipei is still the previous day in UTC.
    expect(localToUtc('2026-12-01', '07:30', 'Asia/Taipei')).toBe(Date.UTC(2026, 10, 30, 23, 30));
  });

  test('follows daylight saving in the zone on that date, not today', () => {
    expect(localToUtc('2026-07-01', '12:00', 'America/Los_Angeles')).toBe(
      Date.UTC(2026, 6, 1, 19, 0),
    );
    expect(localToUtc('2026-12-01', '12:00', 'America/Los_Angeles')).toBe(
      Date.UTC(2026, 11, 1, 20, 0),
    );
  });

  test('keeps zones that are not a whole number of hours off UTC', () => {
    expect(localToUtc('2026-12-01', '10:00', 'Asia/Kolkata')).toBe(Date.UTC(2026, 11, 1, 4, 30));
  });

  test('accepts slashes, single digits and an unpadded hour', () => {
    expect(localToUtc('2026/12/1', '7:30', 'Asia/Taipei')).toBe(Date.UTC(2026, 10, 30, 23, 30));
  });

  test('refuses dates and times that do not exist', () => {
    expect(localToUtc('2026-02-30', '10:00', 'Asia/Taipei')).toBeNull();
    expect(localToUtc('2026-12-01', '25:00', 'Asia/Taipei')).toBeNull();
    expect(localToUtc('2026-12-01', '10:60', 'Asia/Taipei')).toBeNull();
    expect(localToUtc('', '10:00', 'Asia/Taipei')).toBeNull();
    expect(localToUtc('next tuesday', '10:00', 'Asia/Taipei')).toBeNull();
    expect(localToUtc('2026-12-01', '', 'Asia/Taipei')).toBeNull();
  });

  test('refuses a zone it does not know', () => {
    expect(localToUtc('2026-12-01', '10:00', 'Mars/Olympus')).toBeNull();
  });
});

describe('utcToLocal', () => {
  test('gives the date and time on the clocks at that airport', () => {
    expect(utcToLocal(Date.UTC(2026, 10, 30, 23, 30), 'Asia/Taipei')).toEqual({
      date: '2026-12-01',
      time: '07:30',
    });
    expect(utcToLocal(Date.UTC(2026, 11, 2, 3, 30), 'America/Los_Angeles')).toEqual({
      date: '2026-12-01',
      time: '19:30',
    });
  });

  test('round-trips with localToUtc', () => {
    const utc = localToUtc('2026-07-15', '01:15', 'Europe/London') as number;
    expect(utcToLocal(utc, 'Europe/London')).toEqual({ date: '2026-07-15', time: '01:15' });
  });
});

describe('offsetToZone', () => {
  test('turns a typed whole-hour offset into a zone the clock functions understand', () => {
    const zone = offsetToZone('+9') as string;
    expect(localToUtc('2026-12-01', '09:00', zone)).toBe(Date.UTC(2026, 11, 1, 0, 0));
    expect(offsetToZone('UTC-5')).toBe(offsetToZone('-05'));
    expect(localToUtc('2026-12-01', '07:00', offsetToZone('-5') as string)).toBe(
      Date.UTC(2026, 11, 1, 12, 0),
    );
    expect(localToUtc('2026-12-01', '07:00', offsetToZone('0') as string)).toBe(
      Date.UTC(2026, 11, 1, 7, 0),
    );
  });

  test('refuses what it cannot represent rather than rounding it', () => {
    expect(offsetToZone('+5:30')).toBeNull();
    expect(offsetToZone('+15')).toBeNull();
    expect(offsetToZone('')).toBeNull();
    expect(offsetToZone('Tokyo')).toBeNull();
  });
});
