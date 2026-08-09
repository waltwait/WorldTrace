/**
 * Background recording.
 *
 * This task is the *only* writer of the track. The OS delivers fixes here
 * whether the app is in the foreground, backgrounded, or has been evicted
 * entirely — so having the UI subscribe separately would mean two independent
 * trackers, each with its own gatekeeper state, writing duplicate points and
 * splitting segments against each other. The screen reads the database
 * instead.
 *
 * `defineTask` has to run at module scope, before React renders, or a
 * cold start triggered by the OS finds no handler registered. index.ts
 * imports this module first for that reason.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { SqlDriver } from '../store/driver';
import { createExpoDriver } from '../store/expoDriver';
import { migrate } from '../store/schema';
import { createTracker, type Tracker } from '../store/tracker';
import { readDeviceFlags } from './expoLocationSource';
import { toFix } from './toFix';

export const BACKGROUND_LOCATION_TASK = 'worldtrace-background-location';

export class LocationPermissionDenied extends Error {
  constructor(readonly kind: 'foreground' | 'background') {
    super(`${kind} location permission was not granted`);
    this.name = 'LocationPermissionDenied';
  }
}

/**
 * Built once per JS context and reused. A cold start from the OS gets a fresh
 * gatekeeper with no previous fix, which correctly opens a new segment.
 */
let pipeline: Promise<Tracker> | null = null;

/** The driver behind the pipeline, kept so a restore can close it. */
let pipelineDriver: SqlDriver | null = null;

function tracker(): Promise<Tracker> {
  pipeline ??= (async () => {
    const driver = await createExpoDriver();
    await migrate(driver);
    pipelineDriver = driver;
    return createTracker({ driver });
  })();

  return pipeline;
}

/**
 * Let go of the database, so a restore can replace the file underneath.
 *
 * This is a *second* connection, separate from the one the screens share — the
 * background task owns its own. Both have to be closed before the file is
 * swapped, or whichever is left open starts refusing writes and recording stops
 * without a word.
 */
export async function releaseRecordingPipeline(): Promise<void> {
  const driver = pipelineDriver;
  pipeline = null;
  pipelineDriver = null;

  try {
    await driver?.close();
  } catch {
    // Nothing to release. The next fix rebuilds the pipeline regardless.
  }
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[WorldTrace] background location error', error.message);
    return;
  }

  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
  if (!locations?.length) return;

  const recorder = await tracker();
  const device = await readDeviceFlags();

  // Sequentially: the gatekeeper's speed and acceleration checks depend on
  // seeing fixes in the order they happened.
  for (const location of locations) {
    await recorder.record(toFix(location), device);
  }
});

export async function startBackgroundRecording(): Promise<void> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED) {
    throw new LocationPermissionDenied('foreground');
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== Location.PermissionStatus.GRANTED) {
    throw new LocationPermissionDenied('background');
  }

  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
    return;
  }

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 10,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'WorldTrace 記錄中',
      notificationBody: '正在擦開你走過的迷霧',
      notificationColor: '#0b1020',
    },
  });
}

export async function stopBackgroundRecording(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}

export async function isRecording(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
}
