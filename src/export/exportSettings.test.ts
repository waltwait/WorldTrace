import { describe, expect, test } from 'vitest';
import {
  DEFAULT_EXPORT_SETTINGS,
  DOWNLOADS_FOLDER_HINT,
  folderLabel,
  parseExportSettings,
  serializeExportSettings,
} from './exportSettings';

describe('parseExportSettings', () => {
  test('shares, with no folder chosen, until told otherwise', () => {
    expect(parseExportSettings(null)).toEqual({ mode: 'share', folderUri: null });
    expect(DEFAULT_EXPORT_SETTINGS).toEqual({ mode: 'share', folderUri: null });
  });

  test('reads back what was written', () => {
    const settings = { mode: 'save' as const, folderUri: 'content://x/tree/primary%3ADownload%2FWorldTrace' };

    expect(parseExportSettings(serializeExportSettings(settings))).toEqual(settings);
  });

  // The file lives outside the database, so nothing else vouches for it. A file
  // that cannot be read must cost the user a choice, never the screen.
  test('falls back to the default for a file that is not JSON', () => {
    expect(parseExportSettings('{ not json')).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(parseExportSettings('')).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  test('falls back to the default for JSON of the wrong shape', () => {
    expect(parseExportSettings('[]')).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(parseExportSettings('"save"')).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(parseExportSettings('null')).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  test('ignores a mode it does not know, rather than guessing', () => {
    expect(parseExportSettings('{"mode":"upload","folderUri":null}').mode).toBe('share');
  });

  test('ignores a folder that is not a string', () => {
    expect(parseExportSettings('{"mode":"save","folderUri":42}')).toEqual({ mode: 'save', folderUri: null });
    expect(parseExportSettings('{"mode":"save","folderUri":""}')).toEqual({ mode: 'save', folderUri: null });
  });

  test('keeps a valid half when the other half is bad', () => {
    expect(parseExportSettings('{"mode":"save"}')).toEqual({ mode: 'save', folderUri: null });
  });
});

describe('folderLabel', () => {
  const tree = (id: string) => `content://com.android.externalstorage.documents/tree/${encodeURIComponent(id)}`;

  test('names a folder in Downloads the way the user chose it', () => {
    expect(folderLabel(tree('primary:Download/WorldTrace'))).toBe('Download/WorldTrace');
  });

  test('drops the internal storage prefix and nothing else', () => {
    expect(folderLabel(tree('primary:Download'))).toBe('Download');
    expect(folderLabel(tree('primary:Documents/備份/WorldTrace'))).toBe('Documents/備份/WorldTrace');
  });

  test('keeps a memory card readable instead of showing its id', () => {
    expect(folderLabel(tree('1A2B-3C4D:Backups'))).toBe('1A2B-3C4D/Backups');
  });

  test('reads a document address as well as a tree address', () => {
    expect(
      folderLabel('content://com.android.externalstorage.documents/document/primary%3ADownload%2FWorldTrace'),
    ).toBe('Download/WorldTrace');
  });

  // A folder picked inside Downloads comes back as the tree it was picked from
  // plus the document that is the folder itself; the folder is the document.
  test('names the folder itself, not the tree it was picked from', () => {
    expect(
      folderLabel('content://p/tree/primary%3ADownload/document/primary%3ADownload%2FWorldTrace'),
    ).toBe('Download/WorldTrace');
  });

  test('never throws on an address it does not recognise', () => {
    expect(folderLabel('')).toBe('');
    expect(folderLabel('not a uri at all')).toBe('not a uri at all');
    expect(folderLabel('content://some.other.provider/whatever')).toBe('whatever');
  });
});

describe('DOWNLOADS_FOLDER_HINT', () => {
  // Where the picker opens. Android will not let an app be granted Downloads
  // itself, only a folder inside it, so this is a place to start from.
  test('points at Downloads on the internal storage', () => {
    expect(decodeURIComponent(DOWNLOADS_FOLDER_HINT)).toContain('primary:Download');
    expect(DOWNLOADS_FOLDER_HINT.startsWith('content://')).toBe(true);
  });
});
