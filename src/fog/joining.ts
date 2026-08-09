/**
 * Whether the ground between two fixes can be claimed as travelled.
 *
 * Shared by live recording and by rebuilding from stored points, because those
 * two must agree. If they drift, replaying the same track produces different
 * fog from the fog that was painted at the time, and neither is trustworthy.
 *
 * Speed is deliberately not checked here. By the time a pair reaches this
 * point the gatekeeper has refused anything faster than an airliner and has
 * already broken the segment across any longer silence — so a leg that
 * survives is one somebody plausibly travelled, on foot, by car or in the air.
 * What is left to guard is a silence long enough that the route is anyone's
 * guess, and a leg long enough to be expensive to paint.
 */

import { distanceMeters } from '../geo/distance';

export interface JoinLimits {
  maxInterpolationSeconds: number;
  maxInterpolationMeters: number;
}

export interface JoinablePoint {
  lat: number;
  lon: number;
  timestamp: number;
}

export function canJoin(from: JoinablePoint, to: JoinablePoint, limits: JoinLimits): boolean {
  const elapsedSeconds = (to.timestamp - from.timestamp) / 1000;
  if (elapsedSeconds > limits.maxInterpolationSeconds) return false;

  return distanceMeters(from, to) <= limits.maxInterpolationMeters;
}
