/**
 * The land under a shared picture's flight arcs, as rings of [longitude, latitude].
 * Only coastlines, the same for everyone: see land.ts for where they come from.
 */

import { LAND } from './land';

let decoded: Array<Array<[number, number]>> | null = null;

/** Decoded on first use and kept: nothing draws land until a picture is made. */
export function landRings(): ReadonlyArray<ReadonlyArray<[number, number]>> {
  decoded ??= LAND.map((ring) => {
    const points: Array<[number, number]> = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i + 1 < ring.length; i += 2) {
      x += ring[i];
      y += ring[i + 1];
      points.push([x / 100, y / 100]);
    }
    return points;
  });
  return decoded;
}
