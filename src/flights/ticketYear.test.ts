import { describe, expect, test } from 'vitest';
import { yearFor } from './ticketYear';

const NOW = Date.UTC(2026, 10, 7, 2, 0); // 7 November 2026

describe('a date with its weekday printed', () => {
  // "Wed 03 Mar" from a booking mail. Only one of the years around now has it on
  // a Wednesday, so nothing is being guessed.
  test('is the year that weekday falls in', () => {
    expect(yearFor(3, 3, 'Wed', NOW, 'mail')).toEqual({ year: 2027, guessed: false });
  });

  test('can be a date already past', () => {
    // 3 March 2026 was a Tuesday.
    expect(yearFor(3, 3, 'Tue', NOW, 'mail')).toEqual({ year: 2026, guessed: false });
  });

  test('reads the weekday however it is written', () => {
    for (const weekday of ['Wed', 'WED', 'wednesday']) {
      expect(yearFor(3, 3, weekday, NOW).year).toBe(2027);
    }
  });

  test('that fits no nearby year is a guess', () => {
    expect(yearFor(3, 3, 'Sun', NOW, 'mail').guessed).toBe(true);
  });
});

describe('a date with neither year nor weekday', () => {
  // A boarding pass is printed at check-in: it is in your hand on the day or
  // after, never months before.
  test('on a boarding pass is the last time that date came round', () => {
    expect(yearFor(7, 12, null, NOW, 'ticket')).toEqual({ year: 2026, guessed: true });
    expect(yearFor(12, 20, null, NOW, 'ticket').year).toBe(2025);
  });

  test('on a boarding pass can be tomorrow, across the date line', () => {
    expect(yearFor(11, 8, null, NOW, 'ticket').year).toBe(2026);
  });

  test('anywhere else is the next time that date comes round', () => {
    expect(yearFor(7, 12, null, NOW, 'mail')).toEqual({ year: 2027, guessed: true });
    expect(yearFor(12, 20, null, NOW).year).toBe(2026);
  });
});

test('29 February with no leap year nearby has no year at all', () => {
  expect(yearFor(2, 29, null, NOW)).toEqual({ year: null, guessed: false });
});
