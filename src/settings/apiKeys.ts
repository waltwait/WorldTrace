/**
 * The API keys the app uses, entered on the settings page and kept on the phone.
 *
 * They used to be EXPO_PUBLIC_ variables, which are written into the bundle in
 * plain text, in an APK published on a public release page: anyone could lift a
 * paid key out of it. A key here belongs to whoever typed it in. It is kept out
 * of the database for the same reason: a backup or a snapshot must not carry it.
 *
 * The store sits behind KeyStore, as SQL sits behind SqlDriver.
 */

export type ApiKeyName = 'flightStatus';

export const API_KEYS: ReadonlyArray<{ name: ApiKeyName; label: string }> = [
  { name: 'flightStatus', label: '航班 API 金鑰' },
];

export interface KeyStore {
  get(name: ApiKeyName): Promise<string | null>;
  set(name: ApiKeyName, value: string): Promise<void>;
  remove(name: ApiKeyName): Promise<void>;
}

/** Keeps the key as pasted, less the line break a paste brings; nothing removes it. */
export async function saveApiKey(store: KeyStore, name: ApiKeyName, text: string): Promise<void> {
  const value = text.trim();
  await (value ? store.set(name, value) : store.remove(name));
}

export async function readApiKey(store: KeyStore, name: ApiKeyName): Promise<string | null> {
  try {
    return await store.get(name);
  } catch {
    // The Keystore can lose its key, after a restore onto another phone for one.
    // That is a key to enter again, not a reason to take a screen down.
    return null;
  }
}

/** Enough to recognise a key by, and no more. */
export function maskKey(key: string): string {
  return key.length > 7 ? `••••${key.slice(-4)}` : '••••';
}
