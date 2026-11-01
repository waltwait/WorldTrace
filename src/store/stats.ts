/**
 * Derived numbers, read straight from the track.
 */

import { distanceMeters } from '../geo/distance';
import type { SqlDriver } from './driver';
import { sharedReads } from './sharedRead';

interface PointRow {
  segment_id: number;
  lat: number;
  lon: number;
}

export interface PointsSignature {
  count: number;
  lastTs: number | null;
}

export async function getPointsSignature(driver: SqlDriver): Promise<PointsSignature> {
  const row = await driver.get<{ count: number; last_ts: number | null }>(
    'SELECT count(*) AS count, max(ts) AS last_ts FROM points',
  );
  return {
    count: row?.count ?? 0,
    lastTs: row?.last_ts ?? null,
  };
}

export function samePointsSignature(a: PointsSignature, b: PointsSignature): boolean {
  return a.count === b.count && a.lastTs === b.lastTs;
}

const distanceReads = sharedReads<PointsSignature, number>(samePointsSignature);

/** Where a segment's last point was, so the next one can be joined to it. */
interface Tail {
  ts: number;
  lat: number;
  lon: number;
}

/**
 * What the last distance read left behind: enough to carry on from, so that a
 * new point costs one leg rather than the whole track again. Never changed once
 * made — a read that fails or is overtaken must not leave a half-updated one.
 */
interface DistanceState {
  signature: PointsSignature;
  total: number;
  /** The newest point read. Ids only ever go up, so "after this" is "new". */
  lastId: number;
  tails: ReadonlyMap<number, Tail>;
}

interface DistanceRow {
  id: number;
  segment_id: number;
  ts: number;
  lat: number;
  lon: number;
}

const remembered = new WeakMap<SqlDriver, DistanceState>();

/**
 * Walk rows that are in (segment, time) order, adding the legs within a segment
 * to what is already known. Null when a row is older than its segment's last
 * point: the cheap answer would join the wrong points, so the caller must fall
 * back to reading everything.
 */
function carryOn(
  rows: DistanceRow[],
  total: number,
  tails: ReadonlyMap<number, Tail>,
  lastId: number,
): { total: number; tails: Map<number, Tail>; lastId: number } | null {
  const next = new Map(tails);
  let newest = lastId;

  for (const row of rows) {
    const before = next.get(row.segment_id);
    if (before !== undefined) {
      if (row.ts < before.ts) return null;
      total += distanceMeters(before, row);
    }
    next.set(row.segment_id, { ts: row.ts, lat: row.lat, lon: row.lon });
    if (row.id > newest) newest = row.id;
  }

  return { total, tails: next, lastId: newest };
}

async function readAll(driver: SqlDriver, signature: PointsSignature): Promise<DistanceState> {
  const rows = await driver.all<DistanceRow>(
    `SELECT id, segment_id, ts, lat, lon
       FROM points
      ORDER BY segment_id, ts, id`,
  );

  // Rows are in time order within each segment, so this cannot be refused.
  const done = carryOn(rows, 0, new Map(), 0)!;
  return { signature, ...done };
}

/**
 * The answer from what was remembered plus the points added since, or null if
 * that cannot be trusted. It is only trusted when the arithmetic closes: the
 * rows found are exactly the rows the signature says were added, and the newest
 * time is the one they imply. Anything else — points deleted, one inserted under
 * an id already passed, a restore — falls through to a full read, which is the
 * only answer that is right by construction.
 */
async function readNew(
  driver: SqlDriver,
  before: DistanceState,
  signature: PointsSignature,
): Promise<DistanceState | null> {
  if (signature.count < before.signature.count) return null;

  const rows = await driver.all<DistanceRow>(
    `SELECT id, segment_id, ts, lat, lon
       FROM points
      WHERE id > ?
      ORDER BY segment_id, ts, id`,
    [before.lastId],
  );

  if (rows.length !== signature.count - before.signature.count) return null;

  const done = carryOn(rows, before.total, before.tails, before.lastId);
  if (done === null) return null;

  let newestTs = before.signature.lastTs;
  for (const row of rows) {
    if (newestTs === null || row.ts > newestTs) newestTs = row.ts;
  }
  if (newestTs !== signature.lastTs) return null;

  return { signature, ...done };
}

/**
 * Ground covered, summed leg by leg.
 *
 * Legs are only counted within a segment. The gap between two segments is a
 * flight, a subway ride, or a phone that was switched off — never a walk — so
 * joining across one would invent distance that was never travelled.
 *
 * On a walk the track grows at every poll, which defeats a cache keyed on the
 * track as it stands. So the last answer is kept along with where each segment
 * ended, and a read after new points reads only those.
 */
export async function totalDistanceMeters(
  driver: SqlDriver,
  knownSig?: PointsSignature,
): Promise<number> {
  const sig = knownSig ?? (await getPointsSignature(driver));

  return distanceReads.get(driver, sig, async () => {
    const before = remembered.get(driver);
    const state =
      (before ? await readNew(driver, before, sig) : null) ?? (await readAll(driver, sig));

    // Reads for different signatures can overlap; keep whichever has seen more.
    const current = remembered.get(driver);
    if (!current || state.signature.count >= current.signature.count) {
      remembered.set(driver, state);
    }

    return state.total;
  });
}
