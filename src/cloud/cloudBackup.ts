/**
 * Backup to the user's own Google Drive.
 *
 * Everything decidable lives elsewhere and is tested: which endpoint to call
 * (drive.ts), whether a backup is due (schedule.ts), whether a downloaded file
 * is really a database (verify.ts). What is left here is the ordering — and the
 * one rule that matters is that the live database is never destroyed before a
 * replacement is known to be good.
 */

import { File, Paths } from 'expo-file-system';
import { releaseRecordingPipeline } from '../capture/backgroundTask';
import { exportSnapshot, restoreFromSnapshot } from '../export/backup';
import { closeDatabase, database } from '../store/database';
import type { SqlDriver } from '../store/driver';
import { readMeta, readMetaNumber, writeMeta } from '../store/meta';
import { createDrive, type RemoteBackup } from './drive';
import { createExpoDriveTransport } from './expoDriveTransport';
import { isGoogleConfigured } from './googleConfig';
import { restoreSession, signIn, signOut, type Account } from './googleAuth';
import { shouldBackUp, type BackupDecision } from './schedule';
import { looksLikeSqlite, SQLITE_HEADER_BYTES } from './verify';

export type { Account } from './googleAuth';
export type { RemoteBackup } from './drive';

function drive() {
  return createDrive(createExpoDriveTransport());
}

export interface CloudStatus {
  /** Whether this build was given a Google client ID at all. */
  configured: boolean;
  account: Account | null;
  /** When this device last uploaded, from the database's own record. */
  lastBackupAt: number | null;
  /** What is actually sitting in Drive right now, if we could look. */
  remote: RemoteBackup | null;
}

/**
 * Where cloud backup stands, without prompting for anything.
 *
 * Deliberately forgiving: a failed lookup returns a status with no remote
 * rather than throwing. This runs when the screen opens, and a device that is
 * merely offline should see its local state, not an error.
 */
export async function loadCloudStatus(driver: SqlDriver): Promise<CloudStatus> {
  const configured = isGoogleConfigured();
  const lastBackupAt = await readMetaNumber(driver, 'last_backup_at');

  if (!configured) {
    return { configured, account: null, lastBackupAt, remote: null };
  }

  const account = await restoreSession();
  if (account === null) {
    return { configured, account: null, lastBackupAt, remote: null };
  }

  try {
    return { configured, account, lastBackupAt, remote: await drive().findBackup() };
  } catch {
    return { configured, account, lastBackupAt, remote: null };
  }
}

/** Sign in, showing the account picker. Null if the user backed out. */
export async function connect(): Promise<Account | null> {
  return signIn();
}

/**
 * Sign out, leaving the backup in Drive.
 *
 * The file stays on purpose: signing out on a phone that is about to be sold
 * or wiped is exactly when the backup matters most. Deleting it is a separate,
 * explicit action.
 */
export async function disconnect(): Promise<void> {
  await signOut();
}

/** Upload the database now, whatever the schedule says. */
export async function backUpNow(driver: SqlDriver): Promise<RemoteBackup> {
  const snapshot = await exportSnapshot(driver);

  try {
    const id = await drive().upload(snapshot.uri);

    await writeMeta(driver, 'last_backup_file_id', id);
    await writeMeta(driver, 'last_backup_at', String(Date.now()));

    return { id, name: snapshot.fileName, bytes: snapshot.bytes, modifiedAt: Date.now() };
  } finally {
    // The snapshot is a full copy of the database sitting in the cache. Left
    // behind, every backup would add another one.
    const copy = new File(snapshot.uri);
    if (copy.exists) copy.delete();
  }
}

/**
 * Upload only if one is due.
 *
 * Returns the decision either way so the screen can say why nothing happened,
 * rather than leaving the user wondering whether it is broken.
 */
export async function autoBackUp(driver: SqlDriver): Promise<BackupDecision> {
  if (!isGoogleConfigured()) return { backUp: false, reason: 'no-data' };
  if ((await restoreSession()) === null) return { backUp: false, reason: 'no-data' };

  const [lastBackupAt, latest] = await Promise.all([
    readMetaNumber(driver, 'last_backup_at'),
    driver.get<{ last: number | null }>('SELECT MAX(ts) AS last FROM points'),
  ]);

  const decision = shouldBackUp({
    now: Date.now(),
    lastBackupAt,
    lastRecordedAt: latest?.last ?? null,
  });

  if (decision.backUp) await backUpNow(driver);

  return decision;
}

/**
 * Pull the backup down and put it in place of the live database.
 *
 * The download lands in the cache and is checked there. Only once it is known
 * to be a real SQLite file does the live database get touched — and even then
 * the old one is copied aside first, by restoreFromSnapshot.
 *
 * The app has to be restarted afterwards: expo-sqlite is still holding the
 * replaced file open. Callers are expected to say so.
 */
export async function restoreFromCloud(driver: SqlDriver): Promise<void> {
  const remote = await drive().findBackup();
  if (remote === null) {
    throw new Error('雲端上沒有找到備份');
  }

  const scratch = new File(Paths.cache, 'worldtrace-restore.db');
  await drive().download(remote.id, scratch.uri);

  if (!scratch.exists) {
    throw new Error('下載失敗，沒有取得檔案');
  }

  const head = (await scratch.bytes()).slice(0, SQLITE_HEADER_BYTES);
  if (!looksLikeSqlite(head)) {
    scratch.delete();
    throw new Error('下載到的檔案不是有效的備份，已停止還原');
  }

  // Order matters, and only from here on is anything destructive. Both
  // connections — the screens' and the background task's — have to let go of
  // the file before it is replaced. Leaving either open does not fail: it
  // silently turns every later write into "readonly database", and recording
  // stops until the app is restarted.
  await releaseRecordingPipeline();
  await closeDatabase();

  await restoreFromSnapshot(scratch.uri);
  scratch.delete();

  // The restored database carries its own backup history. Keeping this
  // device's stamp would make the schedule think the restored data had already
  // been uploaded. Written through a fresh connection, since the old one is
  // deliberately gone.
  await writeMeta(await database(), 'last_backup_at', String(Date.now()));
}

/** Which Drive file this device last wrote to, if any. */
export async function lastBackupFileId(driver: SqlDriver): Promise<string | null> {
  return readMeta(driver, 'last_backup_file_id');
}
