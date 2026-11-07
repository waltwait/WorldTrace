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

/**
 * Saves only what a sync changed. The network takes seconds, and a whole record
 * read before it would put back anything the user edited in that time.
 */
export async function saveSyncedFlight(
  driver: SqlDriver,
  before: FlightRecord,
  after: FlightRecord,
): Promise<void> {
  const changed = Object.fromEntries(
    Object.entries(after).filter(([key, value]) => before[key as keyof FlightRecord] !== value),
  ) as Partial<FlightRecord>;
  await updateFlight(driver, before.id, changed);
}

/**
 * Hands back the flights as they are once the polls are done, read again: one
 * added or deleted during those seconds must not be undone by an old list.
 */
export async function refreshDueFlights(
  driver: SqlDriver,
  port: FlightStatusPort,
  now: number,
): Promise<FlightRecord[]> {
  // One at a time: a refresh is a handful of flights, and the API is metered.
  for (const flight of await listFlights(driver)) {
    if (!shouldPollFlight(flight, now)) continue;

    try {
      const next = await syncFlightStatus(flight, port, now);
      if (next !== flight) await saveSyncedFlight(driver, flight, next);
    } catch {
      // One flight that cannot be synced must not hide the rest of the list.
    }
  }
  return listFlights(driver);
}
