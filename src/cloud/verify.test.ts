import { describe, expect, test } from 'vitest';
import { SQLITE_HEADER_BYTES, looksLikeSqlite } from './verify';

function sqliteHeader(): Uint8Array {
  const bytes = new Uint8Array(200);
  bytes.set(new TextEncoder().encode('SQLite format 3\0'));
  return bytes;
}

describe('looksLikeSqlite', () => {
  test('accepts a real SQLite file header', () => {
    expect(looksLikeSqlite(sqliteHeader())).toBe(true);
  });

  test('rejects an empty file', () => {
    // Drive answering with nothing must not be allowed to replace the live
    // database with nothing.
    expect(looksLikeSqlite(new Uint8Array(0))).toBe(false);
  });

  test('rejects a file too short to hold a header', () => {
    expect(looksLikeSqlite(sqliteHeader().slice(0, SQLITE_HEADER_BYTES - 1))).toBe(false);
  });

  test('rejects an HTML or JSON error page served with a 200', () => {
    // The most likely real failure: an expired token turns the download into
    // an error document, which is a perfectly valid file of the wrong kind.
    const json = new TextEncoder().encode('{"error":{"code":401,"message":"Invalid"}}');

    expect(looksLikeSqlite(json)).toBe(false);
  });

  test('rejects a file whose header is nearly right', () => {
    const bytes = sqliteHeader();
    bytes[14] = 0x34; // "SQLite format 4"

    expect(looksLikeSqlite(bytes)).toBe(false);
  });

  test('requires the terminating null, not just the words', () => {
    const bytes = sqliteHeader();
    bytes[15] = 0x20;

    expect(looksLikeSqlite(bytes)).toBe(false);
  });
});
