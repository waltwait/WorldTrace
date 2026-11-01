/**
 * How exports leave the app, and where "save to phone" puts them.
 *
 * Kept as a small file next to the database, not in it. The database is
 * replaced wholesale by a restore, and the folder the user chose is a permission
 * Android granted to *this install*: carried in from a backup made on another
 * phone it would point at a place this one was never given. A settings file
 * outside the SQLite folder survives a restore untouched.
 *
 * The file is not trusted. Nothing else vouches for it, so anything wrong with
 * it costs the user a choice, never the screen.
 */

export type ExportMode = 'share' | 'save';

export interface ExportSettings {
  mode: ExportMode;
  /** The folder the user picked, as the system gave it back; null until they have. */
  folderUri: string | null;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { mode: 'share', folderUri: null };

/**
 * Where the folder picker opens. Android 11 and later will not grant an app
 * Downloads itself, only a folder inside it, so this is somewhere to start from
 * and the user chooses (or makes) a folder from there.
 */
export const DOWNLOADS_FOLDER_HINT =
  'content://com.android.externalstorage.documents/document/primary%3ADownload';

export function parseExportSettings(raw: string | null): ExportSettings {
  if (!raw) return DEFAULT_EXPORT_SETTINGS;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_EXPORT_SETTINGS;
  }

  const { mode, folderUri } = value as Record<string, unknown>;

  return {
    mode: mode === 'save' ? 'save' : 'share',
    folderUri: typeof folderUri === 'string' && folderUri.length > 0 ? folderUri : null,
  };
}

export function serializeExportSettings(settings: ExportSettings): string {
  return JSON.stringify(settings);
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/**
 * A folder as the user would say it: "Download/WorldTrace", not an address.
 *
 * Android's document addresses carry the storage volume and the path in one
 * encoded segment. The internal volume is left out; a memory card keeps its id,
 * since that is all there is to tell it by.
 */
export function folderLabel(uri: string): string {
  const match = /\/document\/([^/?#]+)/.exec(uri) ?? /\/tree\/([^/?#]+)/.exec(uri);

  if (!match) {
    const last = uri.split('/').filter(Boolean).pop() ?? '';
    return decode(last);
  }

  const id = decode(match[1]);
  if (id.startsWith('primary:')) return id.slice('primary:'.length);

  return id.replace(':', '/');
}
