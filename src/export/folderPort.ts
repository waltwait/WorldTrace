/**
 * The system side of saving to a folder: the picker, and writing into what it
 * returned. As little as can be, since this is the part that can only be tried
 * on a phone; the decisions are in saveToFolder.ts, where they are tested.
 */

import { Directory, File } from 'expo-file-system';
import { isPickerCancelled, type FolderPort } from './saveToFolder';

export function createFolderPort(explain: () => Promise<boolean>): FolderPort {
  return {
    explainPick: explain,

    async pick(initialUri) {
      try {
        // The system remembers the grant for this install, so the folder stays
        // writable after the app is closed.
        const folder = await Directory.pickDirectoryAsync(initialUri);
        return folder.uri;
      } catch (error) {
        if (isPickerCancelled(error)) return null;
        throw error;
      }
    },

    async write(folderUri, name, mime, sourceUri) {
      // Read in and written out rather than copied: writing into a document
      // folder is the path the module documents for content addresses.
      const bytes = new Uint8Array(await new File(sourceUri).arrayBuffer());
      const target = new Directory(folderUri).createFile(name, mime);

      target.write(bytes);
    },
  };
}
