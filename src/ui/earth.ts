/**
 * Putting the explored area into some kind of perspective.
 *
 * A first walk uncovers a few thousand square metres — around a ten-billionth
 * of the planet. Scientific notation states that honestly and communicates
 * nothing; "88 億分之一" states the same thing in a unit people already use for
 * large numbers. A familiar landmark carries the rest of the sense of scale.
 */

/** Total surface area of the earth, oceans included, in square metres. */
export const EARTH_SURFACE_SQUARE_METERS = 510_072_000 * 1_000_000;

interface Magnitude {
  name: string;
  value: number;
}

/** Largest first, so the first one that fits is the one that reads best. */
const MAGNITUDES: Magnitude[] = [
  { name: '兆', value: 1e12 },
  { name: '億', value: 1e8 },
  { name: '萬', value: 1e4 },
];

/**
 * The explored area as a share of the whole planet.
 *
 * Two forms, splitting exactly at one part in ten thousand. Above it a
 * percentage reads naturally and keeps growing sensibly all the way to 100%.
 * Below it the percentage collapses into leading zeroes, so the ratio is
 * inverted into a denominator instead — the number then *falls* as you explore,
 * which is the direction that carries the progress.
 */
export function formatEarthShare(squareMeters: number): string {
  if (squareMeters <= 0) return '0%';

  const share = squareMeters / EARTH_SURFACE_SQUARE_METERS;

  if (share >= 1 / 10_000) {
    return `${(share * 100).toFixed(2)}%`;
  }

  const denominator = 1 / share;
  const magnitude =
    MAGNITUDES.find((candidate) => denominator >= candidate.value) ??
    MAGNITUDES[MAGNITUDES.length - 1];
  const scaled = denominator / magnitude.value;

  // One decimal below ten, where it still carries information; none above,
  // where it is noise on a number nobody can picture anyway.
  const rendered = scaled >= 10 ? Math.round(scaled).toLocaleString('en-US') : scaled.toFixed(1);

  return `${rendered} ${magnitude.name}分之一`;
}

interface Landmark {
  name: string;
  squareMeters: number;
}

/** Ordered small to large; the largest one the area covers at least once wins. */
const LANDMARKS: Landmark[] = [
  { name: '籃球場', squareMeters: 420 },
  { name: '足球場', squareMeters: 7_140 },
  { name: '大安森林公園', squareMeters: 259_000 },
  { name: '台北市', squareMeters: 271_800_000 },
  { name: '台灣', squareMeters: 36_197_000_000 },
];

/**
 * The explored area expressed in something you can picture.
 *
 * Never picks a landmark larger than the area itself — "0.001 個台灣" after a
 * morning walk would be worse than saying nothing.
 */
export function compareToLandmark(squareMeters: number): string | null {
  if (squareMeters <= 0) return null;

  let chosen: Landmark | null = null;
  for (const landmark of LANDMARKS) {
    if (squareMeters >= landmark.squareMeters) chosen = landmark;
  }

  if (chosen === null) {
    const smallest = LANDMARKS[0];
    const fraction = squareMeters / smallest.squareMeters;
    return `約 ${fraction.toFixed(2)} 座${smallest.name}`;
  }

  const multiple = squareMeters / chosen.squareMeters;
  const rendered = multiple >= 10 ? Math.round(multiple).toLocaleString('en-US') : multiple.toFixed(1);

  return `約 ${rendered} 座${chosen.name}`;
}
