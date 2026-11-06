/**
 * Polls the flights that are due and saves what came back.
 *
 * Pulled out of FlightsScreen so it runs against real SQL under test. The
 * screen saved a synced flight only when its status, departure gate or
 * finished flag changed, so an unchanged answer never wrote `lastSyncedAt`:
 * the tiered schedule never saw a sync, and every launch and pull-to-refresh
 * called the API again for every flight. Arrival gate, belt and terminals
 * were dropped the same way.
 */

import { shouldPollFlight, syncFlightStatus, type FlightStatusPort } from '../flights/flightStatusApi';
import type { FlightRecord } from '../flights/types';
import type { SqlDriver } from './driver';
import { listFlights, updateFlight } from './flights';

export async function refreshDueFlights(
  driver: SqlDriver,
  port: FlightStatusPort,
  now: number,
): Promise<FlightRecord[]> {
  const all = await listFlights(driver);
  const out: FlightRecord[] = [];
  // One at a time: a refresh is a handful of flights, and the API is metered.
  for (const flight of all) {
    if (!shouldPollFlight(flight, now)) {
      out.push(flight);
      continue;
    }
    const next = await syncFlightStatus(flight, port, now);
    await updateFlight(driver, flight.id, next);
    out.push(next);
  }
  return out;
}
