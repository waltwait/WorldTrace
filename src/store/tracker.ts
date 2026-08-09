/**
 * The recording pipeline.
 *
 * Every fix the platform produces enters here and takes one of two paths:
 * accepted, in which case it becomes a point and clears fog; or refused, in
 * which case nothing but the reason is kept. Nothing else in the app writes to
 * the track.
 */

import { canJoin } from '../fog/joining';
import { createMemoryCanvas, paintPoint, paintSegment, tilesCovering } from '../fog/paint';
import { FOG_ZOOM } from '../fog/tiles';
import {
  createGatekeeper,
  type DeviceFlags,
  type Fix,
  type Gatekeeper,
  type RejectionReason,
} from '../gatekeeper/gatekeeper';
import { distanceMeters } from '../geo/distance';
import type { SqlDriver } from './driver';

export type TrackResult =
  | { accepted: true; segmentId: number; newlyExploredCells: number }
  | { accepted: false; reason: RejectionReason };

export interface TrackerOptions {
  driver: SqlDriver;
  gatekeeper?: Gatekeeper;
  /** How far around a fix counts as seen. */
  brushRadiusMeters?: number;
  /**
   * Beyond these limits two fixes are no longer evidence of the ground
   * between them — you may have taken any route, so only the endpoints are
   * cleared.
   */
  maxInterpolationSeconds?: number;
  maxInterpolationMeters?: number;
}

export const TRACKER_DEFAULTS = {
  brushRadiusMeters: 30,

  // Matches the gatekeeper's gap: inside one segment the platform is simply
  // failing to report often enough, and the route between two fixes is still
  // the route you took. Five minutes was set for walking; a bicycle covers
  // 500 m in two, so a real ride lost half its corridor to it.
  maxInterpolationSeconds: 1800,

  // Not a claim about plausibility — the gatekeeper already refused anything
  // faster than an airliner. This is a guard on work: a leg this long means
  // loading and rewriting about a thousand fog tiles inside the background
  // task, and beyond it the cost stops being worth the ground.
  maxInterpolationMeters: 500_000,
};

export interface Tracker {
  record(fix: Fix, device: DeviceFlags): Promise<TrackResult>;
  /** Close the open segment — recording stopped deliberately. */
  stop(): Promise<void>;
}

export function createTracker(options: TrackerOptions): Tracker {
  const {
    driver,
    gatekeeper = createGatekeeper(),
    brushRadiusMeters = TRACKER_DEFAULTS.brushRadiusMeters,
    maxInterpolationSeconds = TRACKER_DEFAULTS.maxInterpolationSeconds,
    maxInterpolationMeters = TRACKER_DEFAULTS.maxInterpolationMeters,
  } = options;

  let segmentId: number | null = null;
  let lastPoint: Fix | null = null;
  let hydrated = false;

  /**
   * Pick up where the last process left off.
   *
   * The OS routinely tears the background JS context down between location
   * batches, so a freshly constructed tracker is the normal case. Without
   * this, every batch would open its own one-point segment: no corridors
   * painted, no distance counted, and the gatekeeper's movement checks never
   * running because there would be nothing to compare against.
   */
  async function hydrate(): Promise<void> {
    if (hydrated) return;
    hydrated = true;

    const row = await driver.get<{
      segment_id: number;
      ts: number;
      lat: number;
      lon: number;
      accuracy: number;
      altitude: number | null;
      speed: number | null;
      heading: number | null;
      ended_at: number | null;
    }>(
      `SELECT p.segment_id, p.ts, p.lat, p.lon, p.accuracy, p.altitude, p.speed, p.heading,
              s.ended_at
         FROM points p
         JOIN segments s ON s.id = p.segment_id
        ORDER BY p.ts DESC
        LIMIT 1`,
    );

    if (!row) return;

    const previous: Fix = {
      lat: row.lat,
      lon: row.lon,
      accuracy: row.accuracy,
      timestamp: row.ts,
      altitude: row.altitude,
      speed: row.speed,
      heading: row.heading,
    };

    gatekeeper.resume(previous);
    lastPoint = previous;

    // A closed segment stays closed. Recording was stopped on purpose, and
    // leaving segmentId null makes the next fix open a fresh one — which also
    // stops a corridor being drawn across the deliberate break.
    segmentId = row.ended_at === null ? row.segment_id : null;
  }

  async function closeOpenSegment(): Promise<void> {
    if (segmentId === null || lastPoint === null) return;

    await driver.run('UPDATE segments SET ended_at = ? WHERE id = ?', [
      lastPoint.timestamp,
      segmentId,
    ]);
  }

  /**
   * Open a segment and return its id, atomically.
   *
   * The id comes from the insert itself. Reading it back afterwards with
   * `last_insert_rowid()` asked the *connection* what it had inserted most
   * recently, so any write that landed in between — a rejection, a fog tile —
   * answered instead, and the next point was attached to a segment that did not
   * exist. On device that surfaced as `FOREIGN KEY constraint failed`, and the
   * fix was dropped.
   */
  async function openSegment(startedAt: number): Promise<number> {
    const result = await driver.run('INSERT INTO segments (started_at) VALUES (?)', [startedAt]);

    return result.lastInsertRowId;
  }

  const joinLimits = { maxInterpolationSeconds, maxInterpolationMeters };

  async function clearFog(from: Fix | null, to: Fix): Promise<number> {
    const start = from ?? to;
    const covered = tilesCovering(start, to, brushRadiusMeters);
    const canvas = createMemoryCanvas();

    for (const tile of covered) {
      const row = await driver.get<{ bitmap: Uint8Array }>(
        'SELECT bitmap FROM fog_tiles WHERE z = ? AND x = ? AND y = ?',
        [FOG_ZOOM, tile.x, tile.y],
      );
      // Copy: the driver may hand back a view onto a buffer it reuses.
      if (row) canvas.put(tile.x, tile.y, Uint8Array.from(row.bitmap));
    }

    const painted = from
      ? paintSegment(canvas, from, to, brushRadiusMeters)
      : paintPoint(canvas, to.lat, to.lon, brushRadiusMeters);

    for (const tile of covered) {
      const bitmap = canvas.peek(tile.x, tile.y);
      if (!bitmap) continue;

      await driver.run(
        `INSERT INTO fog_tiles (z, x, y, bitmap, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (z, x, y) DO UPDATE SET bitmap = excluded.bitmap, updated_at = excluded.updated_at`,
        [FOG_ZOOM, tile.x, tile.y, bitmap, to.timestamp],
      );
    }

    return painted;
  }

  /**
   * The tail of the queue of recordings.
   *
   * The OS can start the background task again before the previous run has
   * finished, and both runs share this one tracker. Interleaved, they scramble
   * the gatekeeper: it would see the two batches' fixes shuffled together, read
   * time as running backwards, and refuse perfectly good fixes as time
   * anomalies. Recording is therefore strictly one at a time.
   */
  let queue: Promise<unknown> = Promise.resolve();

  function serialise<T>(work: () => Promise<T>): Promise<T> {
    // Failures are swallowed from the *chain* only, so one bad fix cannot stop
    // every later one; the caller still gets the rejection.
    const result = queue.then(work, work);
    queue = result.catch(() => undefined);

    return result;
  }

  async function recordOne(fix: Fix, device: DeviceFlags): Promise<TrackResult> {
    await hydrate();

    const verdict = gatekeeper.verify(fix, device);

    if (!verdict.accepted) {
      await driver.run('INSERT INTO rejections (ts, reason, accuracy) VALUES (?, ?, ?)', [
        fix.timestamp,
        verdict.reason,
        fix.accuracy,
      ]);
      return { accepted: false, reason: verdict.reason };
    }

    if (verdict.startsNewSegment || segmentId === null) {
      await closeOpenSegment();
      segmentId = await openSegment(fix.timestamp);
      lastPoint = null;
    }

    await driver.run(
      `INSERT INTO points (segment_id, ts, lat, lon, accuracy, altitude, speed, heading)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        segmentId,
        fix.timestamp,
        fix.lat,
        fix.lon,
        fix.accuracy,
        fix.altitude ?? null,
        fix.speed ?? null,
        fix.heading ?? null,
      ],
    );

    const joinFrom = lastPoint && canJoin(lastPoint, fix, joinLimits) ? lastPoint : null;
    const newlyExploredCells = await clearFog(joinFrom, fix);

    lastPoint = fix;
    return { accepted: true, segmentId, newlyExploredCells };
  }

  return {
    record(fix, device) {
      return serialise(() => recordOne(fix, device));
    },

    stop() {
      // Queued behind recording: closing the segment while a fix is halfway
      // through writing would leave the point attached to a segment that had
      // already been marked finished.
      return serialise(async () => {
        await closeOpenSegment();
        segmentId = null;
        lastPoint = null;
      });
    },
  };
}
