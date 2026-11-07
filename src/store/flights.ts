/**
 * Database operations for flights and travel documents.
 */

import type { FlightDocRecord, FlightRecord } from '../flights/types';
import type { SqlDriver, SqlValue } from './driver';

/**
 * Which field lives in which table, and under what column. A flight goes in and
 * comes out whole; only this file knows there are three tables.
 */
const TABLES: ReadonlyArray<{
  name: string;
  key: string;
  columns: Partial<Record<keyof FlightRecord, string>>;
}> = [
  {
    name: 'flights',
    key: 'id',
    columns: {
      flightNumber: 'flight_number',
      depDate: 'dep_date',
      depTime: 'dep_time',
      seat: 'seat',
      notes: 'notes',
      isFinished: 'is_finished',
      createdAt: 'created_at',
    },
  },
  {
    name: 'flight_schedule',
    key: 'flight_id',
    columns: {
      scheduleSource: 'source',
      airlineCode: 'airline_code',
      airlineName: 'airline_name',
      depIata: 'dep_iata',
      arrIata: 'arr_iata',
      depScheduledUtc: 'dep_scheduled_utc',
      arrScheduledUtc: 'arr_scheduled_utc',
      depTz: 'dep_tz',
      arrTz: 'arr_tz',
      depTerminal: 'dep_terminal',
      arrTerminal: 'arr_terminal',
      depCity: 'dep_city',
      arrCity: 'arr_city',
      depCountry: 'dep_country',
      arrCountry: 'arr_country',
      depLat: 'dep_lat',
      depLon: 'dep_lon',
      arrLat: 'arr_lat',
      arrLon: 'arr_lon',
      distanceKm: 'distance_km',
      durationMinutes: 'duration_minutes',
    },
  },
  {
    name: 'flight_status',
    key: 'flight_id',
    columns: {
      status: 'status',
      depEstimatedUtc: 'dep_estimated_utc',
      arrEstimatedUtc: 'arr_estimated_utc',
      depGate: 'dep_gate',
      arrGate: 'arr_gate',
      baggageBelt: 'baggage_belt',
      lastSyncedAt: 'last_synced_at',
    },
  },
];

const JOINED = `SELECT * FROM flights f
  JOIN flight_schedule s ON s.flight_id = f.id
  JOIN flight_status t ON t.flight_id = f.id`;

type FlightRow = Record<string, SqlValue>;

function rowToFlight(row: FlightRow): FlightRecord {
  const flight: Record<string, unknown> = { id: row.id };
  for (const { columns } of TABLES) {
    for (const [field, column] of Object.entries(columns)) flight[field] = row[column] ?? null;
  }
  flight.isFinished = Boolean(row.is_finished);
  return flight as unknown as FlightRecord;
}

function toSql(value: unknown): SqlValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

interface FlightDocRow {
  id: string;
  flight_id: string;
  file_name: string;
  local_uri: string;
  mime_type: string;
  created_at: number;
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
  try {
    for (const { name, key, columns } of TABLES) {
      const fields = Object.keys(columns) as Array<keyof FlightRecord>;
      const names = [key, ...fields.map((field) => columns[field])];
      await driver.run(
        `INSERT OR REPLACE INTO ${name} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        [flight.id, ...fields.map((field) => toSql(flight[field]))],
      );
    }
  } catch (err) {
    // The list joins all three: a flight half written would just vanish.
    await deleteFlight(driver, flight.id);
    throw err;
  }
}

export async function getFlightById(driver: SqlDriver, id: string): Promise<FlightRecord | null> {
  const row = await driver.get<FlightRow>(`${JOINED} WHERE f.id = ?`, [id]);
  return row ? rowToFlight(row) : null;
}

export async function listFlights(
  driver: SqlDriver,
  filter?: { isFinished?: boolean },
): Promise<FlightRecord[]> {
  if (filter?.isFinished !== undefined) {
    const rows = await driver.all<FlightRow>(
      `${JOINED} WHERE f.is_finished = ? ORDER BY s.dep_scheduled_utc ASC`,
      [filter.isFinished ? 1 : 0],
    );
    return rows.map(rowToFlight);
  }

  const rows = await driver.all<FlightRow>(`${JOINED} ORDER BY s.dep_scheduled_utc DESC`);
  return rows.map(rowToFlight);
}

export async function updateFlight(
  driver: SqlDriver,
  id: string,
  fields: Partial<FlightRecord>,
): Promise<void> {
  for (const { name, key, columns } of TABLES) {
    const changed = (Object.keys(fields) as Array<keyof FlightRecord>).filter((f) => columns[f]);
    if (changed.length === 0) continue;

    await driver.run(
      `UPDATE ${name} SET ${changed.map((f) => `${columns[f]} = ?`).join(', ')} WHERE ${key} = ?`,
      [...changed.map((f) => toSql(fields[f])), id],
    );
  }
}

export async function deleteFlight(driver: SqlDriver, id: string): Promise<void> {
  // The schedule, the status and the documents go with it (ON DELETE CASCADE).
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
