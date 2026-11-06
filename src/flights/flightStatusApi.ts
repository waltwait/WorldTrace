/**
 * Flight status tracking and tiered polling scheduler.
 */

import type { FlightRecord, FlightStatus } from './types';
import { utcToLocal } from './zonedTime';

export interface FlightStatusUpdate {
  status?: FlightStatus;
  depEstimatedUtc?: number | null;
  arrEstimatedUtc?: number | null;
  depTerminal?: string | null;
  arrTerminal?: string | null;
  depGate?: string | null;
  arrGate?: string | null;
  baggageBelt?: string | null;
  isFinished?: boolean;
}

export interface FlightStatusPort {
  /**
   * `dateLocal` is the departure date on the departure airport's clocks, which
   * is what a flight number is scheduled by; `depIata` picks the right leg of
   * a number that flies several.
   */
  fetchFlightStatus(
    flightNumber: string,
    dateLocal: string,
    depIata: string,
  ): Promise<FlightStatusUpdate | null>;
}

/**
 * Determines whether a flight is due for a status poll based on its tiered schedule.
 * - > 48h before departure: every 24 hours
 * - 24h ~ 48h before departure: every 4 hours
 * - 6h ~ 24h before departure: every 2 hours
 * - < 6h before departure up to landing: every 15 minutes
 */
export function shouldPollFlight(flight: FlightRecord, nowMs: number = Date.now()): boolean {
  if (flight.isFinished || flight.status === 'CANCELLED') {
    return false;
  }

  if (flight.lastSyncedAt === null || flight.lastSyncedAt === undefined) {
    return true;
  }

  const msUntilDep = flight.depScheduledUtc - nowMs;
  const msSinceLastSync = nowMs - flight.lastSyncedAt;

  if (msUntilDep > 48 * 3600 * 1000) {
    return msSinceLastSync >= 24 * 3600 * 1000;
  }

  if (msUntilDep > 24 * 3600 * 1000) {
    return msSinceLastSync >= 4 * 3600 * 1000;
  }

  if (msUntilDep > 6 * 3600 * 1000) {
    return msSinceLastSync >= 2 * 3600 * 1000;
  }

  // < 6h or in flight
  return msSinceLastSync >= 15 * 60 * 1000;
}

/**
 * Synchronizes a flight record with live status from the given port.
 * Falls back to time-based progression simulation when port returns null.
 */
export async function syncFlightStatus(
  flight: FlightRecord,
  port: FlightStatusPort,
  nowMs: number = Date.now(),
): Promise<FlightRecord> {
  // A flight number is scheduled by the local date at its origin: the UTC
  // date of a 07:30 Taipei departure is the day before, and asking for that
  // day returns yesterday's flight or nothing.
  const dateLocal = utcToLocal(flight.depScheduledUtc, flight.depTz).date;
  let update: FlightStatusUpdate | null = null;

  try {
    update = await port.fetchFlightStatus(flight.flightNumber, dateLocal, flight.depIata);
  } catch {
    update = null;
  }

  if (update) {
    // Null from the API means it does not know yet — a gate is assigned hours
    // before departure — not that there is none. Taking it as a value wiped
    // the gate the user had typed in on every poll a day out.
    return {
      ...flight,
      status: update.status ?? flight.status,
      depEstimatedUtc: update.depEstimatedUtc ?? flight.depEstimatedUtc,
      arrEstimatedUtc: update.arrEstimatedUtc ?? flight.arrEstimatedUtc,
      depTerminal: update.depTerminal ?? flight.depTerminal,
      arrTerminal: update.arrTerminal ?? flight.arrTerminal,
      depGate: update.depGate ?? flight.depGate,
      arrGate: update.arrGate ?? flight.arrGate,
      baggageBelt: update.baggageBelt ?? flight.baggageBelt,
      isFinished: update.isFinished ?? flight.isFinished,
      lastSyncedAt: nowMs,
    };
  }

  // Fallback progression simulation
  let nextStatus = flight.status;
  let nextFinished = flight.isFinished;

  if (nowMs >= flight.arrScheduledUtc) {
    nextStatus = 'LANDED';
    nextFinished = true;
  } else if (nowMs >= flight.depScheduledUtc) {
    nextStatus = 'IN_AIR';
  } else if (flight.depScheduledUtc - nowMs <= 45 * 60 * 1000) {
    nextStatus = 'BOARDING';
  }

  return {
    ...flight,
    status: nextStatus,
    isFinished: nextFinished,
    lastSyncedAt: nowMs,
  };
}

/**
 * AeroDataBox's flight progress status, as one of ours.
 *
 * Undefined where there is no honest equivalent, so a sync keeps the status
 * it had: "Unknown", "Diverted" (no status here for it), and
 * "CanceledUncertain", which is only probably cancelled — calling it
 * cancelled would stop polling for good. The first version matched
 * substrings of the wrong names ("en-route", "active"), so EnRoute and
 * Departed fell through to SCHEDULED and overwrote IN_AIR for the whole
 * flight.
 */
export function mapAeroDataBoxStatus(raw: string | null | undefined): FlightStatus | undefined {
  switch (raw) {
    case 'Expected':
    case 'CheckIn':
      return 'SCHEDULED';
    case 'Boarding':
    case 'GateClosed':
      return 'BOARDING';
    case 'Departed':
    case 'EnRoute':
    case 'Approaching':
      return 'IN_AIR';
    case 'Arrived':
      return 'LANDED';
    case 'Delayed':
      return 'DELAYED';
    case 'Canceled':
      return 'CANCELLED';
    default:
      return undefined;
  }
}

interface AeroDataBoxMovement {
  airport?: { iata?: string | null } | null;
  terminal?: string | null;
  gate?: string | null;
  baggageBelt?: string | null;
}

interface AeroDataBoxLeg {
  status?: string | null;
  departure?: AeroDataBoxMovement | null;
  arrival?: AeroDataBoxMovement | null;
}

/**
 * HTTP provider for AeroDataBox (via RapidAPI). `fetchFn` is injectable so
 * the response handling runs under test without touching the network.
 */
export function createAeroDataBoxPort(
  apiKey?: string,
  fetchFn: typeof fetch = fetch,
): FlightStatusPort {
  return {
    async fetchFlightStatus(flightNumber, dateLocal, depIata) {
      if (!apiKey) return null;

      try {
        const cleanNum = flightNumber.trim().toUpperCase();
        const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(cleanNum)}/${dateLocal}`;

        const res = await fetchFn(url, {
          headers: {
            'X-RapidAPI-Key': apiKey,
            'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
          },
        });

        if (!res.ok) return null;

        const data = (await res.json()) as AeroDataBoxLeg | AeroDataBoxLeg[];
        const legs = Array.isArray(data) ? data : [data];
        // One number can fly several legs on a day (TPE→NRT→HNL). The first
        // leg is not necessarily ours, and another leg's gate is worse than
        // none.
        const from = depIata.trim().toUpperCase();
        const leg = legs.find((l) => l?.departure?.airport?.iata?.toUpperCase() === from);
        if (!leg) return null;

        const status = mapAeroDataBoxStatus(leg.status);
        return {
          status,
          depGate: leg.departure?.gate ?? null,
          arrGate: leg.arrival?.gate ?? null,
          depTerminal: leg.departure?.terminal ?? null,
          arrTerminal: leg.arrival?.terminal ?? null,
          baggageBelt: leg.arrival?.baggageBelt ?? null,
          // Only an arrival finishes a flight; anything else leaves it as it was.
          isFinished: status === 'LANDED' ? true : undefined,
        };
      } catch {
        return null;
      }
    },
  };
}
