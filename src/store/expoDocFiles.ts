/**
 * DocFiles on the phone: kept documents live in `flight-docs/` under the
 * app's documents directory, which Android does not clear the way it clears
 * the cache the pickers copy into.
 */

import { Directory, File, Paths } from 'expo-file-system';
import type { DocFiles } from './flightDocs';

function docsDirectory(): Directory {
  const dir = new Directory(Paths.document, 'flight-docs');
  // Throws on an existing directory unless idempotent.
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

export const expoDocFiles: DocFiles = {
  async keep(sourceUri, name) {
    const target = new File(docsDirectory(), name);
    // copy() returns a promise; unawaited, the row would point at a file
    // still being written (see CLAUDE.md).
    await new File(sourceUri).copy(target);
    return target.uri;
  },
  remove(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
};
