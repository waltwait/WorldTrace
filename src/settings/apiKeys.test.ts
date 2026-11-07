import { describe, expect, test } from 'vitest';
import { API_KEYS, maskKey, readApiKey, saveApiKey, type ApiKeyName, type KeyStore } from './apiKeys';

function memoryStore(): KeyStore & { kept: Map<ApiKeyName, string> } {
  const kept = new Map<ApiKeyName, string>();
  return {
    kept,
    get: async (name) => kept.get(name) ?? null,
    set: async (name, value) => void kept.set(name, value),
    remove: async (name) => void kept.delete(name),
  };
}

describe('saveApiKey', () => {
  // Keys arrive by paste, and a paste brings the line break with it. Sent as it
  // is, that fails as a bad key with nothing on screen to show why.
  test('keeps a pasted key without the white space around it', async () => {
    const store = memoryStore();

    await saveApiKey(store, 'flightStatus', '  abc123\n');

    expect(store.kept.get('flightStatus')).toBe('abc123');
  });

  test('nothing but white space removes the key', async () => {
    const store = memoryStore();
    await saveApiKey(store, 'flightStatus', 'abc123');

    await saveApiKey(store, 'flightStatus', '  \n');

    expect(store.kept.has('flightStatus')).toBe(false);
  });
});

describe('readApiKey', () => {
  test('gives the key that was saved', async () => {
    const store = memoryStore();
    await saveApiKey(store, 'flightStatus', 'def');

    expect(await readApiKey(store, 'flightStatus')).toBe('def');
  });

  test('gives null for a key never saved', async () => {
    expect(await readApiKey(memoryStore(), 'flightStatus')).toBeNull();
  });

  // The Keystore can lose its key, after a restore onto another phone for one.
  // That is a key to enter again, not a reason to take a screen down.
  test('gives null when the store cannot be read', async () => {
    const broken: KeyStore = {
      ...memoryStore(),
      get: async () => {
        throw new Error('could not decrypt');
      },
    };

    expect(await readApiKey(broken, 'flightStatus')).toBeNull();
  });
});

describe('maskKey', () => {
  test('shows only the last four characters', () => {
    expect(maskKey('AIzaSyABCDEF1234')).toBe('••••1234');
  });

  test('shows nothing of a key too short to hide', () => {
    expect(maskKey('abcd')).toBe('••••');
    expect(maskKey('abcdefg')).toBe('••••');
  });
});

test('the settings page has a row for every key the app reads', () => {
  expect(API_KEYS.map((k) => k.name)).toEqual(['flightStatus']);
  for (const key of API_KEYS) expect(key.label).toMatch(/\p{Script=Han}/u);
});
