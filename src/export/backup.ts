/**
 * Export and backup.
 *
 * With no cloud sync, this is the only thing standing between a lost phone and
 * a lost record, so it does the dull thing on purpose: write a real file, hand
 * it to the system share sheet, and let the user put it somewhere they trust.
 *
 * Two formats, for two different jobs. GPX is for other software to read. The
 * database snapshot is for WorldTrace to restore from — it carries the fog
 * bitmaps, which GPX has no way to express.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { databaseFileNames } from '../store/databaseFiles';
import type { SqlDriver } from '../store/driver';
import { DATABASE_NAME } from '../store/expoDriver';
import { loadTrack } from '../store/track';
import { buildGpx } from './gpx';

/** Where expo-sqlite keeps databases. */
function databaseFile(): File {
  return new File(new Directory(Paths.document, 'SQLite'), DATABASE_NAME);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

export interface ExportResult {
  uri: string;
  fileName: string;
  bytes: number;
}

/** Write the whole track out as GPX and return the file. */
export async function exportGpx(driver: SqlDriver): Promise<ExportResult> {
  const segments = await loadTrack(driver);
  const fileName = `worldtrace-${stamp()}.gpx`;
  const file = new File(Paths.cache, fileName);

  if (file.exists) file.delete();
  file.create();
  file.write(buildGpx(segments, { name: `WorldTrace ${stamp()}` }));

  return { uri: file.uri, fileName, bytes: file.size ?? 0 };
}

/**
 * Copy the database out as a restorable snapshot.
 *
 * Copied rather than shared in place: the live database is being written to,
 * and handing out a file that changes underneath the reader is how backups end
 * up subtly corrupt.
 *
 * The checkpoint first is not optional. In WAL mode a committed write lives in
 * `worldtrace.db-wal` until SQLite folds it back into the main file, so copying
 * the `.db` alone can quietly leave out the most recent walking — a backup that
 * looks fine, restores fine, and is missing the days that mattered most.
 * TRUNCATE folds the log back in and empties it, which makes the single file a
 * complete database again.
 */
export async function exportSnapshot(driver: SqlDriver): Promise<ExportResult> {
  const source = databaseFile();
  if (!source.exists) {
    throw new Error('尚未建立資料庫，沒有可備份的內容');
  }

  await driver.exec('PRAGMA wal_checkpoint(TRUNCATE)');

  const fileName = `worldtrace-${stamp()}.db`;
  const destination = new File(Paths.cache, fileName);
  if (destination.exists) destination.delete();

  // Awaited. `copy` returns a promise, and leaving it unawaited meant the size
  // below was read off a file that was still being written — which is why a
  // perfectly good 56 KB upload reported "0 B".
  await source.copy(destination);

  return { uri: destination.uri, fileName, bytes: destination.size ?? 0 };
}

/** Hand a file to the system share sheet. */
export async function share(result: ExportResult): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('這台裝置沒有可用的分享功能');
  }

  await Sharing.shareAsync(result.uri, {
    dialogTitle: result.fileName,
    mimeType: result.fileName.endsWith('.gpx') ? 'application/gpx+xml' : 'application/octet-stream',
  });
}

/**
 * Replace the live database with a snapshot.
 *
 * The app must be restarted afterwards: expo-sqlite holds the old file open,
 * and any connection still pointing at it would keep writing to a database
 * that is no longer there. Callers are expected to tell the user that.
 */
export async function restoreFromSnapshot(snapshotUri: string): Promise<void> {
  const snapshot = new File(snapshotUri);
  if (!snapshot.exists) {
    throw new Error('找不到備份檔');
  }

  const directory = new Directory(Paths.document, 'SQLite');
  const target = databaseFile();

  // Keep the current database until the copy has landed. Losing the live
  // record to a failed restore would be the worst possible outcome here.
  const rescue = new File(Paths.cache, `worldtrace-before-restore-${stamp()}.db`);
  if (target.exists) {
    if (rescue.exists) rescue.delete();
    // Awaited, and before anything is deleted. Unawaited, the delete below
    // could race the copy and the rescue would be a truncated file — the one
    // copy of the live record, lost while trying to protect it.
    await target.copy(rescue);
  }

  // Every sidecar goes, not just the database. A `-wal` left behind describes
  // the file that was just replaced; SQLite then refuses to write at all
  // ("attempt to write a readonly database") and recording stops dead, with
  // nothing on screen to say so.
  for (const name of databaseFileNames(DATABASE_NAME)) {
    const file = new File(directory, name);
    if (file.exists) file.delete();
  }

  await snapshot.copy(target);
}
