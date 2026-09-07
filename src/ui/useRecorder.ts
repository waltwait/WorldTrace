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
import { exploredSquareMeters } from '../fog/area';
import { createFogBuilder, type FogBuilder } from '../fog/fogGeometry';
import { fogFeature, type PolygonFeature, type TileBitmap } from '../fog/geojson';
import { database } from '../store/database';
import type { SqlDriver } from '../store/driver';
import {
  getFogTilesSignature,
  loadAllTiles,
  recentRejections,
  type FogTilesSignature,
  type RejectionSummary,
} from '../store/fogTiles';
import { getPointsSignature, totalDistanceMeters, type PointsSignature } from '../store/stats';

export type RecorderStatus = 'starting' | 'recording' | 'denied' | 'failed';

export interface RecorderState {
  status: RecorderStatus;
  error: string | null;
  tiles: TileBitmap[];
  /** The drawable fog, built here rather than in render: at any real scale it
      costs far too much to sit on the path of a re-render. */
  fog: PolygonFeature;
  exploredSquareMeters: number;
  distanceMeters: number;
  rejections: RejectionSummary[];
  /** Force an immediate re-read, for screens that just changed the data. */
  refresh: () => void;
}

const REFRESH_INTERVAL_MS = 3000;
const REJECTION_WINDOW_MS = 24 * 60 * 60 * 1000;

const EMPTY_FOG = fogFeature([]);

interface CacheState {
  fogSignature: FogTilesSignature | null;
  pointsSignature: PointsSignature | null;
  builder: FogBuilder;
  tiles: TileBitmap[];
  fog: PolygonFeature;
  exploredSquareMeters: number;
  distanceMeters: number;
}

function sameRejections(a: RejectionSummary[], b: RejectionSummary[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].reason !== b[i].reason || a[i].count !== b[i].count || a[i].lastAt !== b[i].lastAt) {
      return false;
    }
  }
  return true;
}

async function readSnapshot(driver: SqlDriver, cache: CacheState) {
  const [fogSig, pointsSig, rejections] = await Promise.all([
    getFogTilesSignature(driver),
    getPointsSignature(driver),
    recentRejections(driver, Date.now() - REJECTION_WINDOW_MS),
  ]);

  let tiles = cache.tiles;
  let fog = cache.fog;
  let explored = cache.exploredSquareMeters;
  let distanceMeters = cache.distanceMeters;

  // Only reload all tile BLOBs and recalculate popcounts if tiles actually changed.
  if (
    cache.fogSignature === null ||
    cache.fogSignature.count !== fogSig.count ||
    cache.fogSignature.lastUpdated !== fogSig.lastUpdated
  ) {
    tiles = await loadAllTiles(driver);
    explored = exploredSquareMeters(tiles);
    // Only the tiles whose bytes moved are traced again; see fogGeometry.ts.
    fog = cache.builder.build(tiles);
    cache.fogSignature = fogSig;
    cache.tiles = tiles;
    cache.fog = fog;
    cache.exploredSquareMeters = explored;
  }

  // Only recompute total distance if points actually changed.
  if (
    cache.pointsSignature === null ||
    cache.pointsSignature.count !== pointsSig.count ||
    cache.pointsSignature.lastTs !== pointsSig.lastTs
  ) {
    distanceMeters = await totalDistanceMeters(driver, pointsSig);
    cache.pointsSignature = pointsSig;
    cache.distanceMeters = distanceMeters;
  }

  return {
    tiles,
    fog,
    rejections,
    distanceMeters,
    exploredSquareMeters: explored,
  };
}

export function useRecorder(): RecorderState {
  const [status, setStatus] = useState<RecorderStatus>('starting');
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<CacheState>({
    fogSignature: null,
    pointsSignature: null,
    builder: createFogBuilder(),
    tiles: [],
    fog: EMPTY_FOG,
    exploredSquareMeters: 0,
    distanceMeters: 0,
  });
  const [data, setData] = useState({
    tiles: [] as TileBitmap[],
    fog: EMPTY_FOG,
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
          const snapshot = await readSnapshot(driver, cacheRef.current);
          if (!cancelled) {
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
            });
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

  // Every screen is memoised on this object. A fresh one per render would
  // defeat all of them, and a tab switch re-renders the tree three times.
  return useMemo(
    () => ({ status, error, ...data, refresh }),
    [status, error, data, refresh],
  );
}
