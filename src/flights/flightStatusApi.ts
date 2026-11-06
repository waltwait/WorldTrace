/**
 * Flight status tracking and tiered polling scheduler.
 */

import type { FlightRecord, FlightStatus } from './types';

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
  fetchFlightStatus(flightNumber: string, dateIso: string): Promise<FlightStatusUpdate | null>;
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
  const dateIso = new Date(flight.depScheduledUtc).toISOString().slice(0, 10);
  let update: FlightStatusUpdate | null = null;

  try {
    update = await port.fetchFlightStatus(flight.flightNumber, dateIso);
  } catch {
    update = null;
  }

  if (update) {
    return {
      ...flight,
      status: update.status ?? flight.status,
      depEstimatedUtc:
        update.depEstimatedUtc !== undefined ? update.depEstimatedUtc : flight.depEstimatedUtc,
      arrEstimatedUtc:
        update.arrEstimatedUtc !== undefined ? update.arrEstimatedUtc : flight.arrEstimatedUtc,
      depTerminal: update.depTerminal !== undefined ? update.depTerminal : flight.depTerminal,
      arrTerminal: update.arrTerminal !== undefined ? update.arrTerminal : flight.arrTerminal,
      depGate: update.depGate !== undefined ? update.depGate : flight.depGate,
      arrGate: update.arrGate !== undefined ? update.arrGate : flight.arrGate,
      baggageBelt: update.baggageBelt !== undefined ? update.baggageBelt : flight.baggageBelt,
      isFinished: update.isFinished !== undefined ? update.isFinished : flight.isFinished,
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
 * Default HTTP provider for AeroDataBox / external aviation API.
 */
export function createAeroDataBoxPort(apiKey?: string): FlightStatusPort {
  return {
    async fetchFlightStatus(flightNumber: string, dateIso: string): Promise<FlightStatusUpdate | null> {
      if (!apiKey) return null;

      try {
        const cleanNum = flightNumber.trim().toUpperCase();
        const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(cleanNum)}/${dateIso}`;

        const res = await fetch(url, {
          headers: {
            'X-RapidAPI-Key': apiKey,
            'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
          },
        });

        if (!res.ok) return null;

        const data = await res.json();
        const leg = Array.isArray(data) ? data[0] : data;
        if (!leg) return null;

        const depGate = leg.departure?.gate ?? null;
        const arrGate = leg.arrival?.gate ?? null;
        const depTerminal = leg.departure?.terminal ?? null;
        const arrTerminal = leg.arrival?.terminal ?? null;
        const baggageBelt = leg.arrival?.baggageBelt ?? null;

        let status: FlightStatus = 'SCHEDULED';
        const rawStatus = (leg.status ?? '').toLowerCase();
        if (rawStatus.includes('landed') || rawStatus.includes('arrived')) {
          status = 'LANDED';
        } else if (rawStatus.includes('active') || rawStatus.includes('en-route') || rawStatus.includes('airborne')) {
          status = 'IN_AIR';
        } else if (rawStatus.includes('boarding')) {
          status = 'BOARDING';
        } else if (rawStatus.includes('cancel')) {
          status = 'CANCELLED';
        } else if (rawStatus.includes('delay')) {
          status = 'DELAYED';
        }

        return {
          status,
          depGate,
          arrGate,
          depTerminal,
          arrTerminal,
          baggageBelt,
          isFinished: status === 'LANDED',
        };
      } catch {
        return null;
      }
    },
  };
}
