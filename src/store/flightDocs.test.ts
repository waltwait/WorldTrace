import { beforeEach, describe, expect, test } from 'vitest';
import type { FlightRecord } from '../flights/types';
import type { SqlDriver } from './driver';
import {
  attachFlightDoc,
  deleteFlightAndDocs,
  docFileName,
  removeFlightDoc,
  type DocFiles,
} from './flightDocs';
import { getFlightById, insertFlight, listFlightDocs } from './flights';
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
  airlineCode: 'BR',
  airlineName: 'EVA Air',
  depIata: 'TPE',
  arrIata: 'NRT',
  depScheduledUtc: 1,
  arrScheduledUtc: 2,
  depTz: 'Asia/Taipei',
  arrTz: 'Asia/Tokyo',
  status: 'SCHEDULED',
  distanceMiles: 1300,
  durationMinutes: 180,
  notificationsEnabled: true,
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
