/**
 * Every file a SQLite database is actually made of.
 *
 * A database is not one file. In WAL mode — which expo-sqlite uses — the
 * committed data may still be sitting in `-wal`, with `-shm` indexing it. Copy
 * or replace only the `.db` and you have taken half a database: the sidecars
 * still describe the file you just replaced.
 *
 * That is not theoretical. Restoring a snapshot over the live database while
 * leaving its `-wal` in place put SQLite into a state where every write failed
 * with "attempt to write a readonly database", and recording stopped dead until
 * the app was restarted — with nothing on screen to say so.
 */

/** The database and its sidecars, database first. */
export function databaseFileNames(name: string): string[] {
  return [name, `${name}-wal`, `${name}-shm`, `${name}-journal`];
}
