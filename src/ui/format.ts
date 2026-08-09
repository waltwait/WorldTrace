/**
 * Turning numbers into something worth looking at.
 */

import type { RejectionReason } from '../gatekeeper/gatekeeper';
import type { Unit } from '../progress/achievements';

const SQUARE_METERS_PER_SQUARE_KM = 1_000_000;
const METERS_PER_KM = 1000;

/**
 * Explored ground, always in square kilometres.
 *
 * The unit never changes, so the number never jumps. Only the precision moves:
 * four decimals below a square kilometre, because a single brush disc is about
 * 2,800 m² and two decimals would leave the readout stuck at 0.00 for the
 * first few walks.
 */
export function formatArea(squareMeters: number): string {
  const squareKm = squareMeters / SQUARE_METERS_PER_SQUARE_KM;
  const decimals = squareKm < 1 ? 4 : 2;

  return `${squareKm.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} km²`;
}

/**
 * Ground covered, always in kilometres.
 *
 * A unit that switches at some threshold makes the number jump around as you
 * walk. Two decimals keep a short outing visible — 46 m still reads as
 * 0.05 km rather than rounding away to nothing.
 */
export function formatDistance(meters: number): string {
  const km = meters / METERS_PER_KM;

  return `${km.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} km`;
}

/**
 * A number written the way its achievement measures it.
 *
 * Lets one achievement card render distances, areas and plain counts without
 * knowing which of the three it happens to be holding.
 */
export function formatByUnit(value: number, unit: Unit): string {
  if (unit === 'distance') return formatDistance(value);
  if (unit === 'area') return formatArea(value);

  return Math.round(value).toLocaleString('en-US');
}

const REJECTION_LABELS: Record<RejectionReason, string> = {
  MOCK_PROVIDER: '模擬定位',
  MOCK_APP_ENABLED: '裝置啟用模擬定位',
  LOW_ACCURACY: '定位精度不足',
  TIME_ANOMALY: '時間戳異常',
  TELEPORT: '移動速度不合理',
  IMPOSSIBLE_ACCEL: '加速度不合理',
};

/**
 * Why a fix was refused, in words.
 *
 * Falls back to the raw reason rather than hiding an unlabelled one: a reason
 * nobody can read is still better than a fix silently vanishing.
 */
export function rejectionLabel(reason: RejectionReason): string {
  return REJECTION_LABELS[reason] ?? reason;
}
