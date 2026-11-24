/**
 * The Expo side of image delivery: copies the snapshot to a clean filename in
 * cache before handing it to the system share sheet (so receiving apps see
 * `worldtrace-trip-...png` rather than a random view-shot temp name), and wires
 * the folder picker and settings file into `deliverImage`.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { share } from './backup';
import { deliverImage, staleShareCopies } from './deliverExport';
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
        // The last card shared stays until now (see staleShareCopies): the app
        // it went to may have read it only after the share sheet returned.
        const cached = new Directory(Paths.cache).list();
        const stale = new Set(staleShareCopies(cached.map((entry) => entry.name), name));
        for (const entry of cached) {
          if (entry instanceof File && stale.has(entry.name)) entry.delete();
        }

        const named = new File(Paths.cache, name);
        if (named.exists) named.delete();
        await new File(uri).copy(named);
        await share({ uri: named.uri, fileName: name, bytes: named.size ?? 0 });
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
