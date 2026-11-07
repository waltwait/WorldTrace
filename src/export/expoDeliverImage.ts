/**
 * The Expo side of image delivery: copies the snapshot to a clean filename in
 * cache before handing it to the system share sheet (so receiving apps see
 * `worldtrace-trip-...png` rather than a random view-shot temp name), and wires
 * the folder picker and settings file into `deliverImage`.
 */

import { File, Paths } from 'expo-file-system';
import { discardExport, share } from './backup';
import { deliverImage } from './deliverExport';
import type { ExportMode } from './exportSettings';
import { createFolderPort } from './folderPort';
import { loadExportSettings, saveExportSettings } from './settingsFile';

export function exportCapturedImage(
  capture: () => Promise<string>,
  explainFolderPick: () => Promise<boolean>,
  action: ExportMode,
  fileName: string,
): Promise<string | null> {
  return deliverImage(
    {
      capture,
      async shareFile(uri, name) {
        const source = new File(uri);
        const named = new File(Paths.cache, name);
        if (named.exists) named.delete();
        await source.copy(named);
        try {
          await share({ uri: named.uri, fileName: name, bytes: named.size ?? 0 });
        } finally {
          discardExport({ uri: named.uri, fileName: name, bytes: 0 });
        }
      },
      loadSettings: loadExportSettings,
      saveSettings: saveExportSettings,
      folder: createFolderPort(explainFolderPick),
      discard(uri) {
        const temp = new File(uri);
        if (temp.exists) temp.delete();
      },
    },
    action,
    fileName,
  );
}
