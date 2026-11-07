/**
 * A trip's links, each kept on one of its flights. The trip itself is worked out
 * from the flights (flights/trips.ts), so this file knows nothing about trips.
 */

import type { FlightLinkRecord } from '../flights/types';
import type { SqlDriver } from './driver';

interface FlightLinkRow {
  id: string;
  flight_id: string;
  url: string;
  title: string | null;
  created_at: number;
}

function rowToLink(row: FlightLinkRow): FlightLinkRecord {
  return {
    id: row.id,
    flightId: row.flight_id,
    url: row.url,
    title: row.title,
    createdAt: row.created_at,
  };
}

export async function insertFlightLink(driver: SqlDriver, link: FlightLinkRecord): Promise<void> {
  await driver.run(
    'INSERT INTO flight_links (id, flight_id, url, title, created_at) VALUES (?, ?, ?, ?, ?)',
    [link.id, link.flightId, link.url, link.title, link.createdAt],
  );
}

/** Every link, the oldest first: few enough to read whole. */
export async function listFlightLinks(driver: SqlDriver): Promise<FlightLinkRecord[]> {
  const rows = await driver.all<FlightLinkRow>('SELECT * FROM flight_links ORDER BY created_at ASC');
  return rows.map(rowToLink);
}

export async function deleteFlightLink(driver: SqlDriver, id: string): Promise<void> {
  await driver.run('DELETE FROM flight_links WHERE id = ?', [id]);
}

/** Before a flight is deleted, so its trip keeps them. */
export async function moveFlightLinks(driver: SqlDriver, from: string, to: string): Promise<void> {
  await driver.run('UPDATE flight_links SET flight_id = ? WHERE flight_id = ?', [to, from]);
}
