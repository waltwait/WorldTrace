/**
 * Connects the screen to the recording that is happening underneath it.
 *
 * The hook deliberately does not record anything: the background task owns
 * that (see capture/backgroundTask.ts). Here we start the task, then read the
 * database on an interval so the map reflects fog cleared while the screen was
 * closed, or by fixes the OS delivered in a batch.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  LocationPermissionDenied,
  startBackgroundRecording,
} from '../capture/backgroundTask';
import { exploredSquareMeters } from '../fog/area';
import type { TileBitmap } from '../fog/geojson';
import { database } from '../store/database';
import type { SqlDriver } from '../store/driver';
import { loadAllTiles, recentRejections, type RejectionSummary } from '../store/fogTiles';
import { totalDistanceMeters } from '../store/stats';

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
const REJECTION_WINDOW_MS = 24 * 60 * 60 * 1000;

async function readSnapshot(driver: SqlDriver) {
  const [tiles, rejections, distanceMeters] = await Promise.all([
    loadAllTiles(driver),
    recentRejections(driver, Date.now() - REJECTION_WINDOW_MS),
    totalDistanceMeters(driver),
  ]);

  return {
    tiles,
    rejections,
    distanceMeters,
    // Measured here rather than at each screen, so the map panel and the stats
    // page can never disagree about how much has been uncovered.
    exploredSquareMeters: exploredSquareMeters(tiles),
  };
}

export function useRecorder(): RecorderState {
  const [status, setStatus] = useState<RecorderStatus>('starting');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState({
    tiles: [] as TileBitmap[],
    rejections: [] as RejectionSummary[],
    distanceMeters: 0,
    exploredSquareMeters: 0,
  });
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        const driver = await database();
        if (cancelled) return;

        await startBackgroundRecording();
        if (cancelled) return;

        const read = async () => {
          const snapshot = await readSnapshot(driver);
          if (!cancelled) {
            setData(snapshot);
            setStatus('recording');
          }
        };

        await read();
        timer = setInterval(() => void read(), REFRESH_INTERVAL_MS);
      } catch (caught) {
        if (cancelled) return;

        setStatus(caught instanceof LocationPermissionDenied ? 'denied' : 'failed');
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      // Recording deliberately continues after the screen goes away — that is
      // the entire point of the background task.
    };
  }, [tick]);

  return { status, error, ...data, refresh };
}
