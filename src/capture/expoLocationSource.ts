/**
 * The real GPS source.
 *
 * Thin by design: it asks for permission, subscribes, and converts. Every
 * decision about whether a fix counts happens in the gatekeeper, which is
 * testable; nothing here is.
 *
 * This is foreground tracking. Background recording — the point of the
 * product — is a task-manager registration that builds on this and is the
 * next piece of work; see the spec.
 */

import * as Location from 'expo-location';
import type { LocationSource } from './source';
import { toFix } from './toFix';

export class LocationPermissionError extends Error {
  constructor(readonly status: Location.PermissionStatus) {
    super(`Location permission was not granted (${status})`);
    this.name = 'LocationPermissionError';
  }
}

export interface ExpoLocationOptions {
  /** Minimum movement before a new fix is delivered. */
  distanceIntervalMeters?: number;
  /** Minimum time between fixes. */
  timeIntervalMs?: number;
}

export function createExpoLocationSource(
  options: ExpoLocationOptions = {},
): LocationSource {
  const { distanceIntervalMeters = 5, timeIntervalMs = 3000 } = options;
  let subscription: Location.LocationSubscription | null = null;

  return {
    async start(onFix) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) {
        throw new LocationPermissionError(status);
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: distanceIntervalMeters,
          timeInterval: timeIntervalMs,
        },
        (location) => {
          void onFix(toFix(location));
        },
      );
    },

    async stop() {
      subscription?.remove();
      subscription = null;
    },
  };
}

/**
 * Device-level signals the gatekeeper needs.
 *
 * `mockAppEnabled` is deliberately always false, and detecting it properly is
 * deliberately not implemented.
 *
 * Whether the device names a mock location app is a device-wide setting that
 * says nothing about whether a given fix was faked. Someone can keep one
 * configured for an unrelated app indefinitely; refusing on that basis would
 * reject their genuine GPS for as long as it stays configured, which breaks
 * the app for exactly the people it is meant to serve.
 *
 * The per-fix `mocked` flag is the precise version of the same defence: it
 * refuses the fixes that were actually faked and lets real ones through, even
 * while a mock app sits installed and enabled. That flag arrives through
 * toFix() and is checked by the gatekeeper.
 */
export async function readDeviceFlags(): Promise<{ mockAppEnabled: boolean }> {
  return { mockAppEnabled: false };
}
