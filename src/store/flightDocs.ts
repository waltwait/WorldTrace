/**
 * A flight's tickets and boarding passes: the row and the file together.
 *
 * The first version stored the URI the picker returned. Both pickers hand
 * over a copy in the app's cache directory, which Android clears under
 * storage pressure and the user clears with one button; the row then listed
 * an e-ticket that could no longer be opened. Attaching now copies the file
 * into the app's own documents first and stores that, and deleting a
 * document or its flight deletes the file too.
 *
 * The file system sits behind DocFiles, as SQL sits behind SqlDriver, so the
 * order of copy, insert and delete runs under test.
 */

import type { FlightDocRecord } from '../flights/types';
import type { SqlDriver } from './driver';
import { deleteFlight, deleteFlightDoc, insertFlightDoc, listFlightDocs } from './flights';

export interface DocFiles {
  /** Copies `sourceUri` into permanent storage as `name`; returns the copy's URI. */
  keep(sourceUri: string, name: string): Promise<string>;
  /** Deletes a kept file. Missing is fine. */
  remove(uri: string): void;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'image/webp': '.webp',
};

/**
 * The kept copy's name: the document id, which is unique, plus an extension
 * so the viewer it is shared to knows what it is.
 */
export function docFileName(docId: string, fileName: string, mimeType: string): string {
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(fileName)?.[1];
  const ext = fromName ? `.${fromName.toLowerCase()}` : (EXTENSION_BY_MIME[mimeType] ?? '');
  return `${docId}${ext}`;
}

export interface PickedDoc {
  id: string;
  flightId: string;
  sourceUri: string;
  fileName: string;
  mimeType: string;
  now: number;
}

export async function attachFlightDoc(
  driver: SqlDriver,
  files: DocFiles,
  picked: PickedDoc,
): Promise<FlightDocRecord> {
  const localUri = await files.keep(
    picked.sourceUri,
    docFileName(picked.id, picked.fileName, picked.mimeType),
  );
  const doc: FlightDocRecord = {
    id: picked.id,
    flightId: picked.flightId,
    fileName: picked.fileName,
    localUri,
    mimeType: picked.mimeType,
    createdAt: picked.now,
  };
  try {
    await insertFlightDoc(driver, doc);
  } catch (err) {
    files.remove(localUri);
    throw err;
  }
  return doc;
}

function removeQuietly(files: DocFiles, uri: string): void {
  try {
    files.remove(uri);
  } catch {
    // The row is gone; a file left behind costs space, not correctness.
  }
}

export async function removeFlightDoc(
  driver: SqlDriver,
  files: DocFiles,
  doc: FlightDocRecord,
): Promise<void> {
  // The row first: a row without its file is a broken document, a file
  // without its row is only wasted space.
  await deleteFlightDoc(driver, doc.id);
  removeQuietly(files, doc.localUri);
}

export async function deleteFlightAndDocs(
  driver: SqlDriver,
  files: DocFiles,
  flightId: string,
): Promise<void> {
  const docs = await listFlightDocs(driver, flightId);
  for (const doc of docs) await deleteFlightDoc(driver, doc.id);
  await deleteFlight(driver, flightId);
  for (const doc of docs) removeQuietly(files, doc.localUri);
}
