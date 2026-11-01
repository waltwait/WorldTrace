/**
 * Saving an export into a folder the user has chosen, so it can be found in the
 * phone's own file manager instead of only being handed to another app.
 *
 * The share sheet was the only way out, and not every phone's share sheet has a
 * "save to this device" in it. Android will not let an app write into Downloads
 * directly, so it is done the way the system provides: the user picks a folder
 * once, the app is granted it for good, and every save after that is silent.
 *
 * The system pieces are behind a port so that the decisions — when to ask, when
 * to ask again, what to remember — can be tested without a phone.
 */

import { DOWNLOADS_FOLDER_HINT } from './exportSettings';

export interface FolderPort {
  /** Tell the user what to choose. False means they would rather not. */
  explainPick(): Promise<boolean>;
  /** Open the system folder picker. Null means it was dismissed. */
  pick(initialUri: string): Promise<string | null>;
  /** Write a copy of `source` into the folder as `name`. */
  write(folderUri: string, name: string, mime: string, sourceUri: string): Promise<void>;
}

export type SaveResult = { saved: true; folderUri: string } | { saved: false };

function mimeOf(fileName: string): string {
  return fileName.endsWith('.gpx') ? 'application/gpx+xml' : 'application/octet-stream';
}

/**
 * Save `file` into the remembered folder, or ask for one.
 *
 * A remembered folder can stop working: permission belongs to an install, the
 * folder to a place that can be deleted. When writing to it fails the user is
 * asked once more, rather than shown an error they cannot do anything about. If
 * the folder they then choose fails too, that is an error worth showing, and
 * it is thrown rather than asked about forever.
 */
export async function saveToFolder(
  port: FolderPort,
  rememberedFolder: string | null,
  file: { uri: string; fileName: string },
): Promise<SaveResult> {
  const mime = mimeOf(file.fileName);

  if (rememberedFolder) {
    try {
      await port.write(rememberedFolder, file.fileName, mime, file.uri);
      return { saved: true, folderUri: rememberedFolder };
    } catch {
      // Fall through to choosing a folder again.
    }
  }

  if (!(await port.explainPick())) return { saved: false };

  const folder = await port.pick(DOWNLOADS_FOLDER_HINT);
  if (folder === null) return { saved: false };

  await port.write(folder, file.fileName, mime, file.uri);
  return { saved: true, folderUri: folder };
}

/**
 * Whether an error is the user dismissing the folder picker. That is an answer,
 * not a failure, and shows no error. Recognised by the code the system module
 * gives it and by its message, so a change to either does not turn a cancel into
 * an error dialog.
 */
export function isPickerCancelled(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const code = (error as { code?: unknown }).code;
  return code === 'ERR_PICKER_CANCELLED' || /cancel/i.test(error.message);
}
