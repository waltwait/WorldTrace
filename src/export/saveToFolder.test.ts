import { describe, expect, test } from 'vitest';
import { DOWNLOADS_FOLDER_HINT } from './exportSettings';
import { isPickerCancelled, saveToFolder, type FolderPort } from './saveToFolder';

const FILE = { uri: 'file:///cache/worldtrace-x.db', fileName: 'worldtrace-x.db', bytes: 2048 };
const DOWNLOADS = 'content://p/tree/primary%3ADownload%2FWorldTrace';
const OTHER = 'content://p/tree/primary%3ADownload%2FOther';

/** A port that records what was asked of it. */
function setup(overrides: Partial<FolderPort> = {}) {
  const calls: string[] = [];
  const writes: Array<{ folder: string; name: string; mime: string; source: string }> = [];

  const port: FolderPort = {
    async explainPick() {
      calls.push('explain');
      return true;
    },
    async pick(initialUri) {
      calls.push(`pick:${initialUri}`);
      return DOWNLOADS;
    },
    async write(folder, name, mime, source) {
      calls.push(`write:${folder}`);
      writes.push({ folder, name, mime, source });
    },
    ...overrides,
  };

  return { port, calls, writes };
}

describe('saveToFolder', () => {
  describe('the first time, with no folder chosen', () => {
    test('says what to choose, then opens the picker at Downloads, then writes there', async () => {
      const { port, calls, writes } = setup();

      const result = await saveToFolder(port, null, FILE);

      expect(calls).toEqual(['explain', `pick:${DOWNLOADS_FOLDER_HINT}`, `write:${DOWNLOADS}`]);
      expect(writes).toHaveLength(1);
      expect(result).toEqual({ saved: true, folderUri: DOWNLOADS });
    });

    test('remembers the folder only once something has been written to it', async () => {
      const { port } = setup({
        async write() {
          throw new Error('disk full');
        },
      });

      await expect(saveToFolder(port, null, FILE)).rejects.toThrow('disk full');
    });

    test('does nothing at all if the user will not choose', async () => {
      const { port, calls } = setup({ explainPick: async () => false });

      const result = await saveToFolder(port, null, FILE);

      expect(result).toEqual({ saved: false });
      expect(calls).toEqual([]);
    });

    test('does nothing if the picker is dismissed', async () => {
      const { port, writes } = setup({ pick: async () => null });

      const result = await saveToFolder(port, null, FILE);

      expect(result).toEqual({ saved: false });
      expect(writes).toEqual([]);
    });
  });

  describe('with a folder already chosen', () => {
    test('writes straight to it, with no question and no picker', async () => {
      const { port, calls } = setup();

      const result = await saveToFolder(port, DOWNLOADS, FILE);

      expect(calls).toEqual([`write:${DOWNLOADS}`]);
      expect(result).toEqual({ saved: true, folderUri: DOWNLOADS });
    });

    test('names the file as it was exported, with a type the system will keep the extension for', async () => {
      const { port, writes } = setup();

      await saveToFolder(port, DOWNLOADS, FILE);
      await saveToFolder(port, DOWNLOADS, { ...FILE, fileName: 'worldtrace-x.gpx' });

      expect(writes[0]).toMatchObject({ name: 'worldtrace-x.db', mime: 'application/octet-stream', source: FILE.uri });
      expect(writes[1]).toMatchObject({ name: 'worldtrace-x.gpx', mime: 'application/gpx+xml' });
    });

    // Permission belongs to an install, and the folder to a place that can be
    // deleted: either can have gone since it was chosen.
    test('when the folder can no longer be written to, asks again, once, and carries on', async () => {
      let fresh = true;
      const { port, calls } = setup({
        async write(folder) {
          calls.push(`write:${folder}`);
          if (folder === DOWNLOADS && fresh) {
            fresh = false;
            throw new Error('permission denied');
          }
        },
        async pick() {
          calls.push('pick');
          return OTHER;
        },
      });

      const result = await saveToFolder(port, DOWNLOADS, FILE);

      expect(calls).toEqual([`write:${DOWNLOADS}`, 'explain', 'pick', `write:${OTHER}`]);
      expect(result).toEqual({ saved: true, folderUri: OTHER });
    });

    test('does not ask again and again if the new folder fails too', async () => {
      const { port, calls } = setup({
        async write(folder) {
          calls.push(`write:${folder}`);
          throw new Error('no');
        },
        async pick() {
          return OTHER;
        },
      });

      await expect(saveToFolder(port, DOWNLOADS, FILE)).rejects.toThrow('no');

      expect(calls.filter((c) => c.startsWith('write'))).toEqual([`write:${DOWNLOADS}`, `write:${OTHER}`]);
    });

    test('if it must ask again and the user declines, reports that nothing was saved', async () => {
      const { port } = setup({
        async write() {
          throw new Error('gone');
        },
        explainPick: async () => false,
      });

      expect(await saveToFolder(port, DOWNLOADS, FILE)).toEqual({ saved: false });
    });
  });
});

describe('isPickerCancelled', () => {
  // Dismissing the picker is an answer, not a failure: it must not raise an
  // error dialog on a screen the user just chose to leave.
  test('recognises the picker being dismissed, by its code', () => {
    expect(isPickerCancelled(Object.assign(new Error('x'), { code: 'ERR_PICKER_CANCELLED' }))).toBe(true);
  });

  test('and by its message, in case the code is not what it was', () => {
    expect(isPickerCancelled(new Error('The file picker was cancelled by the user'))).toBe(true);
    expect(isPickerCancelled(new Error('Canceled'))).toBe(true);
  });

  test('does not mistake a real failure for it', () => {
    expect(isPickerCancelled(new Error('disk full'))).toBe(false);
    expect(isPickerCancelled(Object.assign(new Error('nope'), { code: 'ERR_FILESYSTEM' }))).toBe(false);
  });

  test('is false for something that is not an error at all', () => {
    expect(isPickerCancelled(undefined)).toBe(false);
    expect(isPickerCancelled('cancelled')).toBe(false);
    expect(isPickerCancelled(null)).toBe(false);
  });
});
