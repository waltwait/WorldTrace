import { describe, expect, test } from 'vitest';
import type { TrackDay } from '../store/track';
import { dayTitle, groupDaysByMonth, timeSpan } from './trackDays';

const day = (date: string): TrackDay => ({ date, from: 0, to: 1, pointCount: 5 });

describe('dayTitle', () => {
  const TODAY = new Date(2026, 10, 7, 12);

  test('says today and yesterday', () => {
    expect(dayTitle('2026-11-07', TODAY)).toBe('今天');
    expect(dayTitle('2026-11-06', TODAY)).toBe('昨天');
  });

  test('across a month and a year', () => {
    expect(dayTitle('2026-10-31', new Date(2026, 10, 1, 12))).toBe('昨天');
    expect(dayTitle('2026-12-31', new Date(2027, 0, 1, 12))).toBe('昨天');
  });

  test('is the month and day within the year', () => {
    expect(dayTitle('2026-11-05', TODAY)).toBe('11 月 5 日');
  });

  test('adds the year when it is another one', () => {
    expect(dayTitle('2025-12-31', TODAY)).toBe('2025 年 12 月 31 日');
  });
});

describe('groupDaysByMonth', () => {
  const TODAY = new Date(2026, 10, 7, 12);

  test('keeps the days in order under their month', () => {
    const sections = groupDaysByMonth(
      [day('2026-11-07'), day('2026-11-02'), day('2026-10-30')],
      TODAY,
    );

    expect(sections.map((s) => s.title)).toEqual(['11 月', '10 月']);
    expect(sections[0].data.map((d) => d.date)).toEqual(['2026-11-07', '2026-11-02']);
  });

  test('tells the same month of two years apart', () => {
    const sections = groupDaysByMonth([day('2026-11-07'), day('2025-11-07')], TODAY);

    expect(sections.map((s) => s.title)).toEqual(['11 月', '2025 年 11 月']);
  });

  test('has nothing to say about no days', () => {
    expect(groupDaysByMonth([], TODAY)).toEqual([]);
  });
});

test('timeSpan reads from one time to another, on the phone\'s clock', () => {
  const from = new Date(2026, 10, 7, 8, 5).getTime();
  const to = new Date(2026, 10, 7, 19, 40).getTime();

  expect(timeSpan(from, to)).toBe('08:05 到 19:40');
});
