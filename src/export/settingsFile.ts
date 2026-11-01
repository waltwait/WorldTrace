/**
 * Reading and writing the export settings file. See exportSettings.ts for why it
 * is a file and not a row in the database.
 */

import { File, Paths } from 'expo-file-system';
import {
  DEFAULT_EXPORT_SETTINGS,
  parseExportSettings,
  serializeExportSettings,
  type ExportSettings,
} from './exportSettings';

function settingsFile(): File {
  return new File(Paths.document, 'export-settings.json');
}

export async function loadExportSettings(): Promise<ExportSettings> {
  try {
    const file = settingsFile();
    if (!file.exists) return DEFAULT_EXPORT_SETTINGS;

    return parseExportSettings(await file.text());
  } catch {
    // An unreadable file is the same as no file: the default, and a fresh choice.
    return DEFAULT_EXPORT_SETTINGS;
  }
}

export async function saveExportSettings(settings: ExportSettings): Promise<void> {
  const file = settingsFile();
  if (!file.exists) file.create();

  file.write(serializeExportSettings(settings));
}
