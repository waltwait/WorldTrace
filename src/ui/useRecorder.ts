/**
 * Connects the screen to the recording that is happening underneath it.
 *
 * The hook deliberately does not record anything: the background task owns
 * that (see capture/backgroundTask.ts). Here we start the task, then read the
 * database on an interval so the map reflects fog cleared while the screen was
 * closed, or by fixes the OS delivered in a batch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LocationPermissionDenied,
  startBackgroundRecording,
} from '../capture/backgroundTask';
import type { TileBitmap } from '../fog/geojson';
import { database } from '../store/database';
import type { SqlDriver } from '../store/driver';
import type { RejectionSummary } from '../store/fogTiles';
import { runRecorderLoop } from './recorderLoop';
import {
  readSnapshot,
  sameRejections,
  type CacheState,
  type RecorderSnapshot,
} from './recorderSnapshot';

export type RecorderStatus = 'starting' | 'recording' | 'denied' | 'failed';

export interface RecorderState {
  status: RecorderStatus;
  error: string | null;
  tiles: TileBitmap[];
  exploredSquareMeters: number;
  distanceMeters: number;
  rejections: RejectionSummary[];
  /** Force an immediate re-read, for screens that just changed the data. */
  refresh: () => void;
}

const REFRESH_INTERVAL_MS = 3000;

export function useRecorder(): RecorderState {
  const [status, setStatus] = useState<RecorderStatus>('starting');
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<CacheState>({
    fogSignature: null,
    pointsSignature: null,
    tiles: [],
    exploredSquareMeters: 0,
    distanceMeters: 0,
  });
  const [data, setData] = useState({
    tiles: [] as TileBitmap[],
    rejections: [] as RejectionSummary[],
    distanceMeters: 0,
    exploredSquareMeters: 0,
  });
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    // Recording continues after the screen goes away — that is the entire point
    // of the background task — so stopping only stops this screen listening.
    const loop = runRecorderLoop<SqlDriver, RecorderSnapshot>({
      open: database,
      start: startBackgroundRecording,
      read: (driver, onPartial) => readSnapshot(driver, cacheRef.current, onPartial),
      isDenied: (error) => error instanceof LocationPermissionDenied,
      onSnapshot: (snapshot) =>
        setData((prev) => {
          if (
            prev.tiles === snapshot.tiles &&
            prev.distanceMeters === snapshot.distanceMeters &&
            prev.exploredSquareMeters === snapshot.exploredSquareMeters &&
            sameRejections(prev.rejections, snapshot.rejections)
          ) {
            return prev;
          }
          return snapshot;
        }),
      onStatus: (next, message) => {
        setStatus(next);
        setError(next === 'recording' ? null : (message ?? null));
      },
      onReadError: (caught) => console.warn('[WorldTrace] refresh skipped', caught),
      intervalMs: REFRESH_INTERVAL_MS,
    });

    return () => loop.stop();
  }, [tick]);

  // Every screen is memoised on this object. A fresh one per render would
  // defeat all of them, and a tab switch re-renders the tree three times.
  return useMemo(
    () => ({ status, error, ...data, refresh }),
    [status, error, data, refresh],
  );
}
