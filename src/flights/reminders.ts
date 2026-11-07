/**
 * The reminder before a flight: an hour before it leaves, to photograph the boarding
 * pass and fill in the seat. Only for a flight still without one, since that is all a
 * boarding pass adds; the API has the gate and the rest. Tapped, it goes straight to
 * reading the pass; and reading a pass is offered only from then until it lands.
 */

import type { FlightRecord } from './types';

const LEAD_MS = 3600 * 1000;

export interface Reminder {
  /** One name for each flight, so a change replaces its reminder rather than adding one. */
  id: string;
  flightId: string;
  at: number;
  title: string;
  body: string;
  /** What tapping it starts. */
  opens: 'boardingPass';
}

const departure = (flight: FlightRecord) => flight.depEstimatedUtc ?? flight.depScheduledUtc;

/**
 * Whether a boarding pass can be read for this flight now: from an hour before it
 * leaves, when the reminder comes, until it lands. A pass is in the hand from the gate
 * to the seat, and a seat may change at the gate, so one already filled in does not
 * close it. Outside it the seat is typed by hand.
 */
export function boardingPassOpen(flight: FlightRecord, now: number): boolean {
  if (flight.status === 'CANCELLED') return false;
  const lands = flight.arrEstimatedUtc ?? flight.arrScheduledUtc;
  return now >= departure(flight) - LEAD_MS && now < lands;
}

export function reminderFor(flight: FlightRecord, now: number): Reminder | null {
  if (flight.isFinished || flight.status === 'CANCELLED' || flight.seat) return null;

  // Its own departure: a late flight is reminded of later.
  const at = departure(flight) - LEAD_MS;
  if (at <= now) return null;

  return {
    id: `flight-${flight.id}`,
    flightId: flight.id,
    at,
    title: `${flight.flightNumber} 一小時後起飛`,
    body: '拍登機證更新座位',
    opens: 'boardingPass',
  };
}

export function planReminders(flights: readonly FlightRecord[], now: number): Reminder[] {
  return flights.flatMap((flight) => reminderFor(flight, now) ?? []);
}
