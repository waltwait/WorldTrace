import { describe, expect, test } from 'vitest';
import { deliverImage, staleShareCopies, type ImageDeliveryPort } from './deliverExport';
import type { ExportSettings } from './exportSettings';

const DOWNLOADS = 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2FWorldTrace';
const OTHER = 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2FPhotos';

function setup(initialSettings: ExportSettings = { mode: 'share', folderUri: null }) {
  let settings = initialSettings;
  const events: string[] = [];

  const port: ImageDeliveryPort = {
    async capture() {
      events.push('capture');
      return 'file:///cache/view-shot-123.png';
    },
    async shareFile(uri, fileName) {
      events.push(`share:${fileName}:${uri}`);
    },
    async loadSettings() {
      return settings;
    },
    async saveSettings(next) {
      settings = next;
      events.push(`saveSettings:${next.mode}:${next.folderUri}`);
    },
    folder: {
      async explainPick() {
        events.push('explain');
        return true;
      },
      async pick() {
        events.push('pick');
        return DOWNLOADS;
      },
      async write(folderUri, name, mime, sourceUri) {
        events.push(`write:${folderUri}:${name}:${mime}:${sourceUri}`);
      },
    },
    discard(uri) {
      events.push(`discard:${uri}`);
    },
  };

  return { port, events, currentSettings: () => settings };
}

describe('deliverImage', () => {
  test('shares a captured PNG with its card filename and cleans up the temp file', async () => {
    const { port, events } = setup();

    const message = await deliverImage(port, 'share', 'worldtrace-trip-2026-04-02-9x16.png');

    expect(message).toBeNull();
    expect(events).toEqual([
      'capture',
      'share:worldtrace-trip-2026-04-02-9x16.png:file:///cache/view-shot-123.png',
      'discard:file:///cache/view-shot-123.png',
    ]);
  });

  test('saves to a newly chosen folder, remembers the folder while keeping mode, and cleans up', async () => {
    const { port, events, currentSettings } = setup({ mode: 'share', folderUri: null });

    const message = await deliverImage(port, 'save', 'worldtrace-passport-2026-4x5.png');

    expect(message).toBe('已存到 Download/WorldTrace');
    expect(currentSettings()).toEqual({ mode: 'share', folderUri: DOWNLOADS });
    expect(events).toEqual([
      'capture',
      'explain',
      'pick',
      `write:${DOWNLOADS}:worldtrace-passport-2026-4x5.png:image/png:file:///cache/view-shot-123.png`,
      `saveSettings:share:${DOWNLOADS}`,
      'discard:file:///cache/view-shot-123.png',
    ]);
  });

  test('saves straight into an already remembered folder without re-saving settings', async () => {
    const { port, events } = setup({ mode: 'save', folderUri: OTHER });

    const message = await deliverImage(port, 'save', 'worldtrace-trip-2026-04-02-9x16.png');

    expect(message).toBe('已存到 Download/Photos');
    expect(events).toEqual([
      'capture',
      `write:${OTHER}:worldtrace-trip-2026-04-02-9x16.png:image/png:file:///cache/view-shot-123.png`,
      'discard:file:///cache/view-shot-123.png',
    ]);
  });

  test('returns null and still cleans up the temp file when the folder picker is dismissed', async () => {
    const { port, events } = setup();
    port.folder.pick = async () => null;

    const message = await deliverImage(port, 'save', 'worldtrace-trip-2026-04-02-9x16.png');

    expect(message).toBeNull();
    expect(events).toContain('discard:file:///cache/view-shot-123.png');
  });

  test('still cleans up the temp file when sharing throws', async () => {
    const { port, events } = setup();
    port.shareFile = async () => {
      throw new Error('share failed');
    };

    await expect(deliverImage(port, 'share', 'worldtrace-trip-2026-04-02-9x16.png')).rejects.toThrow(
      'share failed',
    );
    expect(events).toEqual(['capture', 'discard:file:///cache/view-shot-123.png']);
  });
});

describe('staleShareCopies', () => {
  // A shared card cannot be deleted when the share sheet returns: on Android
  // that is when the chooser closes, before the app it went to has read it.
  // So earlier cards go when the next one is shared, and nothing else does.
  test('names the earlier share cards in the cache, and nothing else there', () => {
    const cache = [
      'worldtrace-trip-2026-07-01-9x16.png',
      'worldtrace-passport-all-1x1.png',
      'worldtrace-passport-2026-9x16.png',
      'worldtrace-before-restore-20261101.db',
      'worldtrace-20261101.gpx',
      'worldtrace-restore.db',
      'ImagePicker',
      'view-shot-123.png',
    ];

    expect(staleShareCopies(cache, 'worldtrace-passport-2026-9x16.png')).toEqual([
      'worldtrace-trip-2026-07-01-9x16.png',
      'worldtrace-passport-all-1x1.png',
    ]);
  });
});
