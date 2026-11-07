/**
 * The days on the 足跡 page, in words. Dates here are calendar dates on the
 * phone, as listDays gives them, so "today" is the phone's today too.
 */

import type { TrackDay } from '../store/track';

const pad = (n: number) => String(n).padStart(2, '0');

function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

export function dayTitle(date: string, today: Date): string {
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date === localDate(today)) return '今天';
  if (date === localDate(yesterday)) return '昨天';

  const { year, month, day } = parts(date);
  const inYear = `${month} 月 ${day} 日`;
  return year === today.getFullYear() ? inYear : `${year} 年 ${inYear}`;
}

export interface MonthSection {
  title: string;
  data: TrackDay[];
}

/** Days come newest first and stay that way; a month only needs a year if it is another one. */
export function groupDaysByMonth(days: readonly TrackDay[], today: Date): MonthSection[] {
  const sections: MonthSection[] = [];
  for (const day of days) {
    const { year, month } = parts(day.date);
    const title = year === today.getFullYear() ? `${month} 月` : `${year} 年 ${month} 月`;
    const last = sections[sections.length - 1];
    if (last?.title === title) last.data.push(day);
    else sections.push({ title, data: [day] });
  }
  return sections;
}

export function timeSpan(from: number, to: number): string {
  const clock = (ms: number) => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return `${clock(from)} 到 ${clock(to)}`;
}
