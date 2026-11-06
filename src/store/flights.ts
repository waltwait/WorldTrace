/**
 * Database operations for flights and travel documents.
 */

import type { FlightDocRecord, FlightRecord } from '../flights/types';
import type { SqlDriver, SqlValue } from './driver';

interface FlightRow {
  id: string;
  flight_number: string;
  airline_code: string;
  airline_name: string;
  alliance: string | null;
  dep_iata: string;
  arr_iata: string;
  dep_scheduled_utc: number;
  dep_estimated_utc: number | null;
  arr_scheduled_utc: number;
  arr_estimated_utc: number | null;
  dep_tz: string;
  arr_tz: string;
  dep_terminal: string | null;
  arr_terminal: string | null;
  dep_gate: string | null;
  arr_gate: string | null;
  baggage_belt: string | null;
  status: string;
  distance_miles: number;
  duration_minutes: number;
  seat: string | null;
  cabin_class: string | null;
  pnr: string | null;
  notes: string | null;
  notifications_enabled: number;
  is_finished: number;
  last_synced_at: number | null;
  created_at: number;
}

interface FlightDocRow {
  id: string;
  flight_id: string;
  file_name: string;
  local_uri: string;
  mime_type: string;
  created_at: number;
}

function rowToFlight(row: FlightRow): FlightRecord {
  return {
    id: row.id,
    flightNumber: row.flight_number,
    airlineCode: row.airline_code,
    airlineName: row.airline_name,
    alliance: (row.alliance as FlightRecord['alliance']) ?? null,
    depIata: row.dep_iata,
    arrIata: row.arr_iata,
    depScheduledUtc: row.dep_scheduled_utc,
    depEstimatedUtc: row.dep_estimated_utc ?? null,
    arrScheduledUtc: row.arr_scheduled_utc,
    arrEstimatedUtc: row.arr_estimated_utc ?? null,
    depTz: row.dep_tz,
    arrTz: row.arr_tz,
    depTerminal: row.dep_terminal ?? null,
    arrTerminal: row.arr_terminal ?? null,
    depGate: row.dep_gate ?? null,
    arrGate: row.arr_gate ?? null,
    baggageBelt: row.baggage_belt ?? null,
    status: row.status as FlightRecord['status'],
    distanceMiles: row.distance_miles,
    durationMinutes: row.duration_minutes,
    seat: row.seat ?? null,
    cabinClass: (row.cabin_class as FlightRecord['cabinClass']) ?? null,
    pnr: row.pnr ?? null,
    notes: row.notes ?? null,
    notificationsEnabled: Boolean(row.notifications_enabled),
    isFinished: Boolean(row.is_finished),
    lastSyncedAt: row.last_synced_at ?? null,
    createdAt: row.created_at,
  };
}

function rowToDoc(row: FlightDocRow): FlightDocRecord {
  return {
    id: row.id,
    flightId: row.flight_id,
    fileName: row.file_name,
    localUri: row.local_uri,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  };
}

export async function insertFlight(driver: SqlDriver, flight: FlightRecord): Promise<void> {
  await driver.run(
    `INSERT OR REPLACE INTO flights (
      id, flight_number, airline_code, airline_name, alliance,
      dep_iata, arr_iata, dep_scheduled_utc, dep_estimated_utc,
      arr_scheduled_utc, arr_estimated_utc, dep_tz, arr_tz,
      dep_terminal, arr_terminal, dep_gate, arr_gate, baggage_belt,
      status, distance_miles, duration_minutes, seat, cabin_class,
      pnr, notes, notifications_enabled, is_finished, last_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      flight.id,
      flight.flightNumber,
      flight.airlineCode,
      flight.airlineName,
      flight.alliance ?? null,
      flight.depIata,
      flight.arrIata,
      flight.depScheduledUtc,
      flight.depEstimatedUtc ?? null,
      flight.arrScheduledUtc,
      flight.arrEstimatedUtc ?? null,
      flight.depTz,
      flight.arrTz,
      flight.depTerminal ?? null,
      flight.arrTerminal ?? null,
      flight.depGate ?? null,
      flight.arrGate ?? null,
      flight.baggageBelt ?? null,
      flight.status,
      flight.distanceMiles,
      flight.durationMinutes,
      flight.seat ?? null,
      flight.cabinClass ?? null,
      flight.pnr ?? null,
      flight.notes ?? null,
      flight.notificationsEnabled ? 1 : 0,
      flight.isFinished ? 1 : 0,
      flight.lastSyncedAt ?? null,
      flight.createdAt,
    ],
  );
}

export async function getFlightById(driver: SqlDriver, id: string): Promise<FlightRecord | null> {
  const row = await driver.get<FlightRow>('SELECT * FROM flights WHERE id = ?', [id]);
  return row ? rowToFlight(row) : null;
}

export async function listFlights(
  driver: SqlDriver,
  filter?: { isFinished?: boolean },
): Promise<FlightRecord[]> {
  if (filter?.isFinished !== undefined) {
    const rows = await driver.all<FlightRow>(
      'SELECT * FROM flights WHERE is_finished = ? ORDER BY dep_scheduled_utc ASC',
      [filter.isFinished ? 1 : 0],
    );
    return rows.map(rowToFlight);
  }

  const rows = await driver.all<FlightRow>(
    'SELECT * FROM flights ORDER BY dep_scheduled_utc DESC',
  );
  return rows.map(rowToFlight);
}

export async function updateFlight(
  driver: SqlDriver,
  id: string,
  fields: Partial<FlightRecord>,
): Promise<void> {
  const mapping: Record<string, string> = {
    flightNumber: 'flight_number',
    airlineCode: 'airline_code',
    airlineName: 'airline_name',
    alliance: 'alliance',
    depIata: 'dep_iata',
    arrIata: 'arr_iata',
    depScheduledUtc: 'dep_scheduled_utc',
    depEstimatedUtc: 'dep_estimated_utc',
    arrScheduledUtc: 'arr_scheduled_utc',
    arrEstimatedUtc: 'arr_estimated_utc',
    depTz: 'dep_tz',
    arrTz: 'arr_tz',
    depTerminal: 'dep_terminal',
    arrTerminal: 'arr_terminal',
    depGate: 'dep_gate',
    arrGate: 'arr_gate',
    baggageBelt: 'baggage_belt',
    status: 'status',
    distanceMiles: 'distance_miles',
    durationMinutes: 'duration_minutes',
    seat: 'seat',
    cabinClass: 'cabin_class',
    pnr: 'pnr',
    notes: 'notes',
    notificationsEnabled: 'notifications_enabled',
    isFinished: 'is_finished',
    lastSyncedAt: 'last_synced_at',
  };

  const setClauses: string[] = [];
  const values: SqlValue[] = [];

  for (const [key, val] of Object.entries(fields)) {
    const col = mapping[key];
    if (!col) continue;

    setClauses.push(`${col} = ?`);
    if (typeof val === 'boolean') {
      values.push(val ? 1 : 0);
    } else if (typeof val === 'string' || typeof val === 'number') {
      values.push(val);
    } else {
      values.push(null);
    }
  }

  if (setClauses.length === 0) return;

  values.push(id);
  await driver.run(`UPDATE flights SET ${setClauses.join(', ')} WHERE id = ?`, values);
}

export async function deleteFlight(driver: SqlDriver, id: string): Promise<void> {
  await driver.run('DELETE FROM flights WHERE id = ?', [id]);
}

export async function insertFlightDoc(driver: SqlDriver, doc: FlightDocRecord): Promise<void> {
  await driver.run(
    `INSERT OR REPLACE INTO flight_docs (id, flight_id, file_name, local_uri, mime_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [doc.id, doc.flightId, doc.fileName, doc.localUri, doc.mimeType, doc.createdAt],
  );
}

export async function listFlightDocs(driver: SqlDriver, flightId: string): Promise<FlightDocRecord[]> {
  const rows = await driver.all<FlightDocRow>(
    'SELECT * FROM flight_docs WHERE flight_id = ? ORDER BY created_at ASC',
    [flightId],
  );
  return rows.map(rowToDoc);
}

export async function deleteFlightDoc(driver: SqlDriver, docId: string): Promise<void> {
  await driver.run('DELETE FROM flight_docs WHERE id = ?', [docId]);
}
