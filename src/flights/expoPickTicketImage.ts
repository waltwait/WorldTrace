import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { pickTicketImageUri } from './pickTicketImage';

export function pickTicketImage(): Promise<string | null> {
  return pickTicketImageUri({
    async pickFromLibrary() {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
      if (result.canceled || !result.assets || result.assets.length === 0) return null;
      return result.assets[0].uri;
    },
    async pickFromDocuments() {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return null;
      return result.assets[0].uri;
    },
  });
}
