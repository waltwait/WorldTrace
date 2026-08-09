/**
 * Google Drive, reduced to the four things a backup needs.
 *
 * Everything lives in `appDataFolder` — a per-app space that is hidden from the
 * user's Drive listing and unreachable by any other app. That choice is what
 * keeps the OAuth scope narrow: WorldTrace cannot see anything else in the
 * account, even if it wanted to.
 *
 * The transport is injected rather than calling `fetch` directly. Uploads and
 * downloads have to stream through the native filesystem to avoid holding a
 * whole database in JS memory, and that is not something a test can exercise —
 * so it sits behind a port, and the request-shaping logic here stays testable.
 */

/** One fixed name, so a backup replaces the last one rather than joining it. */
export const BACKUP_FILE_NAME = 'worldtrace-backup.sqlite';

const APP_DATA_FOLDER = 'appDataFolder';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

export interface RemoteBackup {
  id: string;
  name: string;
  bytes: number;
  modifiedAt: number;
}

export interface DriveTransport {
  /** A JSON request. Resolves with the parsed response body. */
  request(init: { method: string; url: string; body?: unknown }): Promise<unknown>;
  /** Streams a local file up as the raw request body. */
  sendFile(init: { method: 'POST' | 'PATCH'; url: string; uri: string }): Promise<void>;
  /** Streams a URL's bytes down to a local path. */
  receiveFile(init: { url: string; uri: string }): Promise<void>;
}

interface FileListResponse {
  files?: { id: string; name: string; size?: string; modifiedTime: string }[];
}

export function createDrive(transport: DriveTransport) {
  /** The current backup in Drive, or null if there has never been one. */
  async function findBackup(): Promise<RemoteBackup | null> {
    const query = new URLSearchParams({
      spaces: APP_DATA_FOLDER,
      fields: 'files(id,name,size,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '10',
    });

    const response = (await transport.request({
      method: 'GET',
      url: `${API}?${query}`,
    })) as FileListResponse;

    const found = response.files?.find((file) => file.name === BACKUP_FILE_NAME);
    if (!found) return null;

    return {
      id: found.id,
      name: found.name,
      // Drive returns size as a string, and omits it entirely for some files.
      bytes: Number(found.size ?? 0),
      modifiedAt: Date.parse(found.modifiedTime),
    };
  }

  /**
   * Write a local file up as the backup, replacing any previous one.
   *
   * Two steps rather than a multipart upload: create or find the metadata
   * record, then stream the bytes into it. Multipart would mean building a
   * body with the file embedded, which defeats streaming.
   */
  async function upload(uri: string): Promise<string> {
    const existing = await findBackup();
    const id = existing?.id ?? (await create());

    await transport.sendFile({
      method: 'PATCH',
      url: `${UPLOAD_API}/${id}?uploadType=media`,
      uri,
    });

    return id;
  }

  async function create(): Promise<string> {
    const created = (await transport.request({
      method: 'POST',
      url: API,
      body: { name: BACKUP_FILE_NAME, parents: [APP_DATA_FOLDER] },
    })) as { id: string };

    return created.id;
  }

  /** Pull the backup's bytes down to a local path. */
  async function download(id: string, uri: string): Promise<void> {
    await transport.receiveFile({ url: `${API}/${id}?alt=media`, uri });
  }

  async function deleteBackup(id: string): Promise<void> {
    await transport.request({ method: 'DELETE', url: `${API}/${id}` });
  }

  return { findBackup, upload, download, deleteBackup };
}

export type Drive = ReturnType<typeof createDrive>;
