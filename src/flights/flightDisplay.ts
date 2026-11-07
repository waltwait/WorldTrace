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

import type { FlightRecord, FlightStatus } from './types';
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
  if (flight.status === 'CANCELLED') return '已取消';
  if (flight.isFinished) return '已完成';
  // The clock says it should have landed, not that it did. See syncFlightStatus.
  if (now >= flight.arrScheduledUtc) return '待確認';
  if (now >= flight.depScheduledUtc) return '飛行中';
  const days = dayNumber(flight.depScheduledUtc, flight.depTz) - dayNumber(now, flight.depTz);
  return days <= 0 ? '今日出發' : `${days} 天`;
}

const STATUS_LABELS: Record<FlightStatus, string> = {
  SCHEDULED: '已排定',
  BOARDING: '登機中',
  IN_AIR: '飛行中',
  LANDED: '已降落',
  DELAYED: '延誤',
  CANCELLED: '已取消',
};

export function statusLabel(flight: FlightRecord): string {
  if (flight.status === 'CANCELLED') return STATUS_LABELS.CANCELLED;
  return flight.isFinished ? '已完成' : STATUS_LABELS[flight.status];
}

function isOver(flight: FlightRecord): boolean {
  return flight.isFinished || flight.status === 'CANCELLED';
}

/** Still to fly, the next one first: that is the one being looked for. */
export function upcomingFlights(flights: readonly FlightRecord[]): FlightRecord[] {
  return flights
    .filter((f) => !isOver(f))
    .sort((a, b) => a.depScheduledUtc - b.depScheduledUtc);
}

/** Flown or cancelled, the latest first. */
export function pastFlights(flights: readonly FlightRecord[]): FlightRecord[] {
  return flights.filter(isOver).sort((a, b) => b.depScheduledUtc - a.depScheduledUtc);
}

/** "Taipei (TPE)". The API names places in English and the app keeps no table of its own. */
export function airportLabel(city: string | null | undefined, iata: string): string {
  return city ? `${city} (${iata})` : iata;
}

/** The flight the overview shows: in the air, or the soonest still to leave. */
export function nextFlight(flights: readonly FlightRecord[], now: number): FlightRecord | null {
  return upcomingFlights(flights).find((f) => now < f.arrScheduledUtc) ?? null;
}

/**
 * The flight on the first page: the next one, or the last one flown when none is
 * coming. A cancelled flight was never flown, so it is nobody's last flight.
 */
export function walletFlight(
  flights: readonly FlightRecord[],
  now: number,
): { flight: FlightRecord; label: string } | null {
  const next = nextFlight(flights, now);
  if (next) return { flight: next, label: '下一班' };

  const last = pastFlights(flights).find((f) => f.status !== 'CANCELLED');
  return last ? { flight: last, label: '上一班' } : null;
}

export interface TicketView {
  from: string;
  to: string;
  /** When it leaves, on the departure airport's clock. */
  when: string;
  stubLabel: string;
  stubValue: string;
  past: boolean;
}

/** What one flight's ticket says. The stub answers the question of the moment. */
export function ticketFor(flight: FlightRecord, now: number): TicketView {
  const { date, time } = utcToLocal(flight.depScheduledUtc, flight.depTz);
  const [, month, day] = date.split('-').map(Number);
  const past = isOver(flight);
  const countdown = departureCountdown(flight, now);

  const stub = (): { stubLabel: string; stubValue: string } => {
    if (flight.status === 'CANCELLED') return { stubLabel: '', stubValue: '已取消' };
    if (flight.isFinished) {
      return flight.seat
        ? { stubLabel: '座位', stubValue: flight.seat }
        : { stubLabel: '', stubValue: '已完成' };
    }
    if (countdown === '今日出發') return { stubLabel: '今天', stubValue: '出發' };
    if (countdown.endsWith(' 天')) return { stubLabel: '還有', stubValue: countdown };
    return { stubLabel: '', stubValue: countdown };
  };

  return {
    from: flight.depIata,
    to: flight.arrIata,
    when: `${month} 月 ${day} 日 ${time}`,
    past,
    ...stub(),
  };
}
