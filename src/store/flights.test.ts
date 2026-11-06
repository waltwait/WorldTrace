import { beforeEach, describe, expect, test } from 'vitest';
import type { SqlDriver } from './driver';
import { createNodeDriver } from './testing/nodeDriver';
import { migrate } from './schema';
import {
  deleteFlight,
  deleteFlightDoc,
  getFlightById,
  insertFlight,
  insertFlightDoc,
  listFlightDocs,
  listFlights,
  updateFlight,
} from './flights';
import type { FlightRecord, FlightDocRecord } from '../flights/types';

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
});

const sampleFlight: FlightRecord = {
  id: 'flight-1',
  flightNumber: 'CI501',
  airlineCode: 'CI',
  airlineName: 'China Airlines',
  alliance: 'SkyTeam',
  depIata: 'TPE',
  arrIata: 'PVG',
  depScheduledUtc: 1767141900000,
  depEstimatedUtc: 1767142500000,
  arrScheduledUtc: 1767149400000,
  arrEstimatedUtc: 1767150000000,
  depTz: 'Asia/Taipei',
  arrTz: 'Asia/Shanghai',
  depTerminal: '2',
  arrTerminal: '1',
  depGate: 'D6',
  arrGate: '18',
  baggageBelt: '7',
  status: 'SCHEDULED',
  distanceMiles: 420.0,
  durationMinutes: 125,
  seat: '24A',
  cabinClass: 'Economy',
  pnr: '7X9K2M',
  notes: 'Window seat booked',
  notificationsEnabled: true,
  isFinished: false,
  lastSyncedAt: 1767000000000,
  createdAt: 1766900000000,
};

describe('flights store', () => {
  test('inserts and retrieves a flight record', async () => {
    await insertFlight(driver, sampleFlight);

    const fetched = await getFlightById(driver, 'flight-1');
    expect(fetched).toEqual(sampleFlight);
  });

  test('returns null when flight is not found', async () => {
    expect(await getFlightById(driver, 'non-existent')).toBeNull();
  });

  test('lists flights ordered and filtered by isFinished', async () => {
    const flight2: FlightRecord = {
      ...sampleFlight,
      id: 'flight-2',
      flightNumber: 'BR198',
      depIata: 'TPE',
      arrIata: 'NRT',
      depScheduledUtc: 1766000000000,
      isFinished: true,
    };
    const flight3: FlightRecord = {
      ...sampleFlight,
      id: 'flight-3',
      flightNumber: 'JX800',
      depIata: 'TPE',
      arrIata: 'NRT',
      depScheduledUtc: 1768000000000,
      isFinished: false,
    };

    await insertFlight(driver, sampleFlight);
    await insertFlight(driver, flight2);
    await insertFlight(driver, flight3);

    const activeFlights = await listFlights(driver, { isFinished: false });
    expect(activeFlights.map((f) => f.id)).toEqual(['flight-1', 'flight-3']);

    const finishedFlights = await listFlights(driver, { isFinished: true });
    expect(finishedFlights.map((f) => f.id)).toEqual(['flight-2']);

    const allFlights = await listFlights(driver);
    expect(allFlights).toHaveLength(3);
  });

  test('updates flight fields', async () => {
    await insertFlight(driver, sampleFlight);

    await updateFlight(driver, 'flight-1', {
      seat: '10K',
      depGate: 'D8',
      status: 'BOARDING',
      isFinished: true,
    });

    const updated = await getFlightById(driver, 'flight-1');
    expect(updated?.seat).toBe('10K');
    expect(updated?.depGate).toBe('D8');
    expect(updated?.status).toBe('BOARDING');
    expect(updated?.isFinished).toBe(true);
    // Other fields untouched
    expect(updated?.flightNumber).toBe('CI501');
  });

  test('deletes a flight and its associated docs', async () => {
    await insertFlight(driver, sampleFlight);

    const doc: FlightDocRecord = {
      id: 'doc-1',
      flightId: 'flight-1',
      fileName: 'boarding-pass.pdf',
      localUri: 'file:///data/bp.pdf',
      mimeType: 'application/pdf',
      createdAt: 1766905000000,
    };
    await insertFlightDoc(driver, doc);

    expect(await listFlightDocs(driver, 'flight-1')).toHaveLength(1);

    await deleteFlight(driver, 'flight-1');

    expect(await getFlightById(driver, 'flight-1')).toBeNull();
    expect(await listFlightDocs(driver, 'flight-1')).toHaveLength(0);
  });

  test('manages flight docs', async () => {
    await insertFlight(driver, sampleFlight);

    const doc1: FlightDocRecord = {
      id: 'doc-1',
      flightId: 'flight-1',
      fileName: 'ticket.pdf',
      localUri: 'file:///docs/ticket.pdf',
      mimeType: 'application/pdf',
      createdAt: 1766901000000,
    };
    const doc2: FlightDocRecord = {
      id: 'doc-2',
      flightId: 'flight-1',
      fileName: 'receipt.png',
      localUri: 'file:///docs/receipt.png',
      mimeType: 'image/png',
      createdAt: 1766902000000,
    };

    await insertFlightDoc(driver, doc1);
    await insertFlightDoc(driver, doc2);

    const docs = await listFlightDocs(driver, 'flight-1');
    expect(docs).toHaveLength(2);
    expect(docs[0].id).toBe('doc-1');
    expect(docs[1].id).toBe('doc-2');

    await deleteFlightDoc(driver, 'doc-1');
    const remaining = await listFlightDocs(driver, 'flight-1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('doc-2');
  });
});
