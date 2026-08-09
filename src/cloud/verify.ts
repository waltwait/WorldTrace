/**
 * Is this actually a database?
 *
 * Restoring overwrites the live record, so the downloaded bytes get checked
 * before anything is replaced. The failure this guards against is not exotic:
 * an expired token turns a Drive download into a small JSON error document
 * served with a perfectly ordinary status, and writing that over the database
 * would destroy the record while looking like a success.
 */

/** The fixed string every SQLite database begins with, including its null. */
const MAGIC = 'SQLite format 3\0';

export const SQLITE_HEADER_BYTES = MAGIC.length;

const EXPECTED = new TextEncoder().encode(MAGIC);

export function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < EXPECTED.length) return false;

  return EXPECTED.every((byte, index) => bytes[index] === byte);
}
