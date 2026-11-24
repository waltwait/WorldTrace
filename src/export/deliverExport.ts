/**
 * Pure delivery flow for a rendered PNG share card: capture it once, hand it to
 * the system share sheet or write it into the remembered folder, persist any
 * newly chosen folder without disturbing the user's default export mode, and
 * always clean up the temporary PNG from cache afterwards.
 */

import { folderLabel, type ExportMode, type ExportSettings } from './exportSettings';
import { saveToFolder, type FolderPort } from './saveToFolder';

export interface ImageDeliveryPort {
  /** Render the fixed-size card view to a temporary PNG file and return its URI. */
  capture(): Promise<string>;
  /** Hand a PNG file to the system share sheet under `fileName`. */
  shareFile(uri: string, fileName: string): Promise<void>;
  loadSettings(): Promise<ExportSettings>;
  saveSettings(settings: ExportSettings): Promise<void>;
  folder: FolderPort;
  discard(uri: string): void;
}

export async function deliverImage(
  port: ImageDeliveryPort,
  action: ExportMode,
  fileName: string,
): Promise<string | null> {
  const uri = await port.capture();

  try {
    if (action === 'share') {
      await port.shareFile(uri, fileName);
      return null;
    }

    const settings = await port.loadSettings();
    const saved = await saveToFolder(port.folder, settings.folderUri, { uri, fileName });
    if (!saved.saved) return null;

    if (saved.folderUri !== settings.folderUri) {
      await port.saveSettings({ ...settings, folderUri: saved.folderUri }).catch(() => {
        // Not being able to remember a folder must not fail a save that already succeeded.
      });
    }

    return `已存到 ${folderLabel(saved.folderUri)}`;
  } finally {
    port.discard(uri);
  }
}

const SHARE_CARD = /^worldtrace-(trip|passport)-.+\.png$/;

/**
 * The share cards in the cache to delete before `sharing` is written: every
 * earlier one, and nothing else there — a restore keeps its rescue copy of the
 * database in the cache too.
 *
 * A card cannot be deleted once the share sheet returns. On Android that is
 * when the chooser closes, not when the app it went to has read the file, and
 * LINE or Instagram then opened a file that was already gone. So each card
 * stays until the next one is shared, and the cache holds one at a time.
 */
export function staleShareCopies(cacheNames: readonly string[], sharing: string): string[] {
  return cacheNames.filter((name) => SHARE_CARD.test(name) && name !== sharing);
}
