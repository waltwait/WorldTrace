/**
 * KeyStore on the phone: expo-secure-store, which encrypts with the Android
 * Keystore. Its entries are excluded from Android Auto Backup in the manifest,
 * since they cannot be decrypted on any other phone.
 */

import * as SecureStore from 'expo-secure-store';
import { readApiKey, type ApiKeyName, type KeyStore } from './apiKeys';

const entry = (name: ApiKeyName) => `worldtrace.apikey.${name}`;

export const expoKeyStore: KeyStore = {
  get: (name) => SecureStore.getItemAsync(entry(name)),
  set: (name, value) => SecureStore.setItemAsync(entry(name), value),
  remove: (name) => SecureStore.deleteItemAsync(entry(name)),
};

/** The key to use right now, or null if none has been entered. */
export function apiKey(name: ApiKeyName): Promise<string | null> {
  return readApiKey(expoKeyStore, name);
}
