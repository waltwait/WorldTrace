/**
 * The device half of the Drive client.
 *
 * Uploads and downloads go through expo-file-system's native transfer rather
 * than through `fetch`, so the database never has to be held in JS memory as a
 * string or a base64 blob. A few megabytes would survive that; a few hundred
 * would not, and the failure would arrive years in, on the one device holding
 * the only copy of the record.
 */

import { File, UploadType } from 'expo-file-system';
import type { DriveTransport } from './drive';
import { accessToken } from './googleAuth';

export function createExpoDriveTransport(): DriveTransport {
  return {
    async request({ method, url, body }) {
      const token = await accessToken();

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await describeFailure(response.status, await response.text()));
      }

      // DELETE answers 204 with an empty body, which JSON.parse would choke on.
      const text = await response.text();
      return text.length === 0 ? {} : JSON.parse(text);
    },

    async sendFile({ method, url, uri }) {
      const token = await accessToken();
      const file = new File(uri);

      const result = await file.upload(url, {
        httpMethod: method,
        uploadType: UploadType.BINARY_CONTENT,
        headers: { Authorization: `Bearer ${token}` },
        mimeType: 'application/x-sqlite3',
      });

      // Unlike fetch, a non-2xx here resolves rather than throwing.
      if (result.status < 200 || result.status >= 300) {
        throw new Error(await describeFailure(result.status, result.body));
      }
    },

    async receiveFile({ url, uri }) {
      const token = await accessToken();
      const destination = new File(uri);

      if (destination.exists) destination.delete();

      await File.downloadFileAsync(url, destination, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
  };
}

/**
 * Google's errors in words worth showing.
 *
 * The raw response is a nested JSON envelope; surfacing it whole in an alert
 * tells the user nothing. The status codes that actually happen get named, and
 * anything else keeps the raw text so a genuinely new failure is not swallowed.
 */
async function describeFailure(status: number, body: string): Promise<string> {
  if (status === 401) return '登入已過期，請重新登入 Google';
  if (status === 403 && body.includes('storageQuotaExceeded')) return 'Google 雲端硬碟空間不足';
  if (status === 403) return `Google 拒絕了這個要求（權限不足）：${trim(body)}`;
  if (status === 404) return '雲端上的備份檔已不存在';

  return `Google Drive 錯誤 ${status}：${trim(body)}`;
}

function trim(body: string): string {
  return body.length > 200 ? `${body.slice(0, 200)}…` : body;
}
