/**
 * What a flight card and the detail sheet show for times and the countdown.
 *
 * Every clock here is the airport's own. The screens used `getHours()`, which
 * is the phone's zone: on a phone in Taipei a Los Angeles arrival read in
 * Taipei time, eight hours out, and a Tokyo departure an hour out. The
 * countdown used `Math.ceil` on milliseconds, so a flight two hours away said
 * "1d", 「今日出發」 appeared only once it had left, and an unfinished flight
 * from three days ago still said it was leaving today.
 */

import type { FlightRecord } from './types';
import { utcToLocal } from './zonedTime';

/** `HH:MM` on the clocks in `timeZone`. */
export function airportTime(utcMs: number, timeZone: string): string {
  return utcToLocal(utcMs, timeZone).time;
}

/** `YYYY/M/D` on the calendar in `timeZone`. */
export function airportDate(utcMs: number, timeZone: string): string {
  const [y, m, d] = utcToLocal(utcMs, timeZone).date.split('-').map(Number);
  return `${y}/${m}/${d}`;
}

function dayNumber(utcMs: number, timeZone: string): number {
  const [y, m, d] = utcToLocal(utcMs, timeZone).date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/**
 * Days to go are calendar days at the departure airport — the day it leaves
 * is the date printed on the ticket — not blocks of 24 hours from now.
 */
export function departureCountdown(flight: FlightRecord, now: number): string {
  if (flight.isFinished) return '已完成';
  if (now >= flight.arrScheduledUtc) return '已抵達';
  if (now >= flight.depScheduledUtc) return '飛行中';
  const days = dayNumber(flight.depScheduledUtc, flight.depTz) - dayNumber(now, flight.depTz);
  return days <= 0 ? '今日出發' : `${days} 天`;
}
