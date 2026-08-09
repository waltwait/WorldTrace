/**
 * The boundary between the platform's idea of a location and ours.
 *
 * Structurally typed against expo-location's LocationObject rather than
 * importing it, so this conversion — the one place the Android mock flag
 * enters the system — can be tested without a React Native runtime.
 */

import type { Fix } from '../gatekeeper/gatekeeper';

export interface PlatformLocation {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    altitude?: number | null;
    speed?: number | null;
    heading?: number | null;
  };
  timestamp: number;
  /** Android only. iOS has no equivalent and never sets it. */
  mocked?: boolean;
}

export function toFix(location: PlatformLocation): Fix {
  const { coords } = location;

  return {
    lat: coords.latitude,
    lon: coords.longitude,
    accuracy: coords.accuracy ?? null,
    timestamp: location.timestamp,
    mocked: location.mocked === true,
    altitude: coords.altitude ?? null,
    speed: coords.speed ?? null,
    heading: coords.heading ?? null,
  };
}
