/**
 * The location gatekeeper.
 *
 * worldTrace only records ground you actually covered. Everything the platform
 * hands us passes through here first, and anything that looks synthetic or
 * physically impossible is refused outright — refused fixes never reach the
 * track and never clear fog.
 *
 * This module is deliberately free of I/O and platform APIs. The rules will be
 * tuned repeatedly, and tuning them must not require going outside with a
 * phone.
 *
 * Platform note: `mocked` only ever arrives on Android. iOS does not expose a
 * mock flag because it does not need one — a non-jailbroken device cannot feed
 * synthetic locations to a third-party app. On iOS the physical checks below
 * are the whole defence, and that is by design; jailbreak detection is not
 * implemented, since its false positives would permanently block honest users.
 */

import { distanceMeters } from '../geo/distance';

export interface Fix {
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres. Null when the platform cannot say. */
  accuracy: number | null;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Set by Android when the fix came from a mock provider. */
  mocked?: boolean;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
}

export interface DeviceFlags {
  /** Android developer options currently name a mock location app. */
  mockAppEnabled: boolean;
}

export type RejectionReason =
  | 'MOCK_PROVIDER'
  | 'MOCK_APP_ENABLED'
  | 'LOW_ACCURACY'
  | 'TIME_ANOMALY'
  | 'TELEPORT'
  | 'IMPOSSIBLE_ACCEL';

export type Verdict =
  | { accepted: true; startsNewSegment: boolean }
  | { accepted: false; reason: RejectionReason };

export interface Limits {
  /** Fixes vaguer than this cannot place you precisely enough to clear fog. */
  maxAccuracyMeters: number;
  /** Above this, no vehicle explains the movement. Airliners cruise near 250. */
  maxSpeedMetersPerSecond: number;
  /** Acceleration above this is not survivable in a vehicle. */
  maxAccelMetersPerSecondSquared: number;
  /** One wild reading is GPS noise; this many in a row is not. */
  maxAccelStreak: number;
  /**
   * Past this silence we cannot reason about the journey between two fixes, so
   * speed checks are meaningless and a new segment begins instead.
   */
  maxGapSeconds: number;
  /**
   * Refuse every fix while the device names a mock location app, rather than
   * only refusing the fixes that are actually mocked.
   *
   * Off by default, and it should almost certainly stay off. The setting is
   * device-wide and says nothing about whether a given fix was faked — people
   * keep a mock location app configured for unrelated apps, and switching this
   * on would reject their genuine GPS for as long as it stays configured. The
   * per-fix `mocked` flag already refuses exactly the fixes that were faked,
   * which is the precise version of the same defence.
   */
  refuseWhenMockAppEnabled: boolean;
  /**
   * Development escape hatch: accept fixes the platform reports as mocked.
   *
   * Off by default, and refusing mocked fixes is the entire premise of the
   * app, so this must never be switched on in a release build. Note that it
   * only stands down the two mock rules — a mock GPS app teleporting across
   * the country is still refused, otherwise testing with one would prove
   * nothing about the real rules.
   *
   * Prefer capture/replaySource for testing movement: it drives this same
   * gatekeeper with recorded fixes and needs no bypass at all.
   */
  allowMockedFixes: boolean;
}

export const DEFAULT_LIMITS: Limits = {
  maxAccuracyMeters: 100,
  maxSpeedMetersPerSecond: 350,
  maxAccelMetersPerSecondSquared: 10,
  maxAccelStreak: 3,
  // Thirty minutes. Below this a silence is the platform failing to report —
  // a tunnel, a pocket, Android's power management — not a new outing. At ten
  // minutes a single night of idling split one record into fourteen segments,
  // which zeroed the distance and broke every fog corridor between them.
  maxGapSeconds: 1800,
  refuseWhenMockAppEnabled: false,
  allowMockedFixes: false,
};

export interface Gatekeeper {
  verify(fix: Fix, device: DeviceFlags): Verdict;
  /**
   * Adopt a previously accepted fix as the starting point.
   *
   * The OS tears the background JS context down between location batches, so
   * a gatekeeper that treated every construction as the start of a journey
   * would have nothing to measure against — and the movement checks would
   * silently never run. The caller loads the last accepted fix from storage
   * and hands it back here.
   *
   * The fix is trusted, not re-verified: it was already accepted once.
   */
  resume(fix: Fix): void;
  /** Forget the journey so far — used when recording is stopped and restarted. */
  reset(): void;
}

export function createGatekeeper(limits: Partial<Limits> = {}): Gatekeeper {
  const config: Limits = { ...DEFAULT_LIMITS, ...limits };

  let lastAccepted: Fix | null = null;
  let lastSpeed: number | null = null;
  let accelStreak = 0;

  function accept(fix: Fix, startsNewSegment: boolean, speed: number | null): Verdict {
    lastAccepted = fix;
    lastSpeed = speed;
    return { accepted: true, startsNewSegment };
  }

  return {
    resume(fix) {
      lastAccepted = fix;
      // The speed leading up to that fix went with the old process. Claiming
      // one would let a fabricated acceleration slip through on the first
      // comparison, so the streak starts empty instead.
      lastSpeed = null;
      accelStreak = 0;
    },

    reset() {
      lastAccepted = null;
      lastSpeed = null;
      accelStreak = 0;
    },

    verify(fix, device) {
      if (!config.allowMockedFixes) {
        if (fix.mocked === true) return { accepted: false, reason: 'MOCK_PROVIDER' };
        if (config.refuseWhenMockAppEnabled && device.mockAppEnabled) {
          return { accepted: false, reason: 'MOCK_APP_ENABLED' };
        }
      }
      if (fix.accuracy === null || fix.accuracy > config.maxAccuracyMeters) {
        return { accepted: false, reason: 'LOW_ACCURACY' };
      }

      if (lastAccepted === null) return accept(fix, true, null);

      if (fix.timestamp <= lastAccepted.timestamp) {
        return { accepted: false, reason: 'TIME_ANOMALY' };
      }

      const elapsedSeconds = (fix.timestamp - lastAccepted.timestamp) / 1000;

      // After a long silence there is no journey to validate — the phone may
      // have been off, underground, or on a plane. Start fresh rather than
      // accuse the user of teleporting.
      if (elapsedSeconds > config.maxGapSeconds) {
        accelStreak = 0;
        return accept(fix, true, null);
      }

      const speed = distanceMeters(lastAccepted, fix) / elapsedSeconds;
      if (speed > config.maxSpeedMetersPerSecond) {
        return { accepted: false, reason: 'TELEPORT' };
      }

      if (lastSpeed !== null) {
        const accel = Math.abs(speed - lastSpeed) / elapsedSeconds;
        accelStreak = accel > config.maxAccelMetersPerSecondSquared ? accelStreak + 1 : 0;

        if (accelStreak > config.maxAccelStreak) {
          return { accepted: false, reason: 'IMPOSSIBLE_ACCEL' };
        }
      }

      return accept(fix, false, speed);
    },
  };
}
