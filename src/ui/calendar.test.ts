import { describe, expect, test } from 'vitest';
import { monthOf, monthWeeks, shiftMonth, todayString, yearPage } from './calendar';

describe('monthWeeks', () => {
  test('starts a month on its weekday, Sunday first', () => {
    // 1 November 2026 is a Sunday, 1 February 2027 a Monday.
    expect(monthWeeks({ year: 2026, month: 11 })[0][0]).toBe('2026-11-01');
    expect(monthWeeks({ year: 2027, month: 2 })[0].slice(0, 2)).toEqual([null, '2027-02-01']);
  });

  test('has every day of the month, once, in order', () => {
    const days = monthWeeks({ year: 2026, month: 11 }).flat().filter(Boolean);

    expect(days).toHaveLength(30);
    expect(days[29]).toBe('2026-11-30');
  });

  test('keeps seven to a week, blanks included', () => {
    for (const week of monthWeeks({ year: 2026, month: 8 })) expect(week).toHaveLength(7);
  });

  test('knows a leap year', () => {
    expect(monthWeeks({ year: 2028, month: 2 }).flat()).toContain('2028-02-29');
    expect(monthWeeks({ year: 2027, month: 2 }).flat()).not.toContain('2027-02-29');
  });
});

describe('shiftMonth', () => {
  test('moves within a year', () => {
    expect(shiftMonth({ year: 2026, month: 6 }, 1)).toEqual({ year: 2026, month: 7 });
  });

  test('crosses into the next year and back', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 });
  });
});

describe('monthOf', () => {
  const today = new Date(2026, 10, 7);

  test('opens on the date already chosen', () => {
    expect(monthOf('2027-03-03', today)).toEqual({ year: 2027, month: 3 });
  });

  // A ticket can leave anything in the box, and a calendar has to open somewhere.
  test.each(['', '2026-02-30', '12月31日'])('opens on today for %j', (text) => {
    expect(monthOf(text, today)).toEqual({ year: 2026, month: 11 });
  });
});

describe('todayString', () => {
  test('is the phone\'s date, not UTC\'s', () => {
    expect(todayString(new Date(2026, 10, 7, 23, 59))).toBe('2026-11-07');
    expect(todayString(new Date(2026, 10, 7, 0, 1))).toBe('2026-11-07');
  });
});

describe('yearPage', () => {
  test('is twelve years with the given one among them', () => {
    const years = yearPage(2026);

    expect(years).toHaveLength(12);
    expect(years).toContain(2026);
  });

  test('turns over without gaps', () => {
    const page = yearPage(2026);

    expect(yearPage(page[11] + 1)[0]).toBe(page[11] + 1);
  });
});
