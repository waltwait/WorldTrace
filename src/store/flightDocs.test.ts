import { beforeEach, describe, expect, test } from 'vitest';
import type { FlightRecord } from '../flights/types';
import type { SqlDriver } from './driver';
import {
  attachFlightDoc,
  deleteFlightAndDocs,
  docFileName,
  removeFlightDoc,
  saveNewFlight,
  type DocFiles,
} from './flightDocs';
import { getFlightById, insertFlight, listFlightDocs, listFlights } from './flights';
import { migrate } from './schema';
import { createNodeDriver } from './testing/nodeDriver';

let driver: SqlDriver;

/** Files in memory: what was kept where, and what is still there. */
function memoryFiles() {
  const stored = new Map<string, string>();
  const files: DocFiles & { stored: Map<string, string>; failNext?: boolean } = {
    stored,
    async keep(sourceUri, name) {
      if (files.failNext) throw new Error('disk full');
      const uri = `file:///data/docs/flight-docs/${name}`;
      stored.set(uri, sourceUri);
      return uri;
    },
    remove(uri) {
      stored.delete(uri);
    },
  };
  return files;
}

const flight: FlightRecord = {
  id: 'f-1',
  flightNumber: 'BR198',
  depDate: '2026-12-01',
  scheduleSource: 'api',
  airlineCode: 'BR',
  airlineName: 'EVA Air',
  depIata: 'TPE',
  arrIata: 'NRT',
  depScheduledUtc: 1,
  arrScheduledUtc: 2,
  depTz: 'Asia/Taipei',
  arrTz: 'Asia/Tokyo',
  status: 'SCHEDULED',
  distanceKm: 1300,
  durationMinutes: 180,
  isFinished: false,
  createdAt: 0,
};

const picked = {
  flightId: 'f-1',
  sourceUri: 'file:///data/cache/DocumentPicker/abc/eticket.pdf',
  fileName: 'eticket.pdf',
  mimeType: 'application/pdf',
};

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
  await insertFlight(driver, flight);
});

describe('attachFlightDoc', () => {
  test('keeps its own copy, since the picker hands over a file in the cache Android may clear', async () => {
    const files = memoryFiles();
    const doc = await attachFlightDoc(driver, files, { ...picked, id: 'doc-1', now: 5 });

    expect(doc.localUri).toBe('file:///data/docs/flight-docs/doc-1.pdf');
    expect(files.stored.get(doc.localUri)).toBe(picked.sourceUri);
    expect(await listFlightDocs(driver, 'f-1')).toEqual([doc]);
    expect(doc.fileName).toBe('eticket.pdf');
  });

  test('records nothing when the copy fails', async () => {
    const files = memoryFiles();
    files.failNext = true;
    await expect(
      attachFlightDoc(driver, files, { ...picked, id: 'doc-1', now: 5 }),
    ).rejects.toThrow('disk full');
    expect(await listFlightDocs(driver, 'f-1')).toEqual([]);
  });
});

describe('removing documents', () => {
  test('deleting a document deletes its file', async () => {
    const files = memoryFiles();
    const doc = await attachFlightDoc(driver, files, { ...picked, id: 'doc-1', now: 5 });
    await removeFlightDoc(driver, files, doc);
    expect(files.stored.size).toBe(0);
    expect(await listFlightDocs(driver, 'f-1')).toEqual([]);
  });

  test('deleting a flight deletes the files of all its documents', async () => {
    const files = memoryFiles();
    await attachFlightDoc(driver, files, { ...picked, id: 'doc-1', now: 5 });
    await attachFlightDoc(driver, files, {
      ...picked,
      id: 'doc-2',
      fileName: 'boarding.jpg',
      mimeType: 'image/jpeg',
      now: 6,
    });
    await deleteFlightAndDocs(driver, files, 'f-1');
    expect(files.stored.size).toBe(0);
    expect(await getFlightById(driver, 'f-1')).toBeNull();
  });
});

describe('docFileName', () => {
  test('names the copy after the document, keeping the extension so it opens', () => {
    expect(docFileName('doc-1', 'eticket.PDF', 'application/pdf')).toBe('doc-1.pdf');
    expect(docFileName('doc-2', 'IMG_2041', 'image/jpeg')).toBe('doc-2.jpg');
    expect(docFileName('doc-3', 'pass', 'image/png')).toBe('doc-3.png');
    expect(docFileName('doc-4', 'odd', 'application/octet-stream')).toBe('doc-4');
  });
});

describe('saveNewFlight', () => {
  const another: FlightRecord = { ...flight, id: 'f-2' };
  const ticket = {
    id: 'doc-9',
    sourceUri: picked.sourceUri,
    fileName: picked.fileName,
    mimeType: picked.mimeType,
    now: 7,
  };

  test('saves the flight and its ticket together', async () => {
    await saveNewFlight(driver, memoryFiles(), another, ticket);

    expect(await getFlightById(driver, 'f-2')).not.toBeNull();
    expect((await listFlightDocs(driver, 'f-2')).map((d) => d.id)).toEqual(['doc-9']);
  });

  test('saves a flight with no ticket', async () => {
    await saveNewFlight(driver, memoryFiles(), another, null);

    expect(await getFlightById(driver, 'f-2')).not.toBeNull();
  });

  // The sheet stays open on an error, and saving again makes a new id: a row
  // left behind here becomes the same flight twice.
  test('leaves no flight behind when the ticket cannot be kept, and says why', async () => {
    const files = memoryFiles();
    files.failNext = true;

    await expect(saveNewFlight(driver, files, another, ticket)).rejects.toThrow('disk full');

    expect(await getFlightById(driver, 'f-2')).toBeNull();
    expect((await listFlights(driver)).map((f) => f.id)).toEqual(['f-1']);
  });
});
