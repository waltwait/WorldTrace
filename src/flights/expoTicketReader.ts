/**
 * TicketImageReader on the phone. ML Kit's text recognition runs on the device
 * through Google Play services; the picture does not leave it.
 */

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { extractTextFromImage } from 'expo-text-extractor';
import { localPath, type TicketImageReader } from './readTicket';

export const expoTicketReader: TicketImageReader = {
  read: (uri) => extractTextFromImage(localPath(uri)),

  async rotate(uri, degrees) {
    const image = await ImageManipulator.manipulate(uri).rotate(degrees).renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG });
    return saved.uri;
  },

  discard(uri) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Not ours to delete, such as a picture still in the gallery.
    }
  },
};
