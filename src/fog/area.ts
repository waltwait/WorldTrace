/**
 * How much ground the cleared fog covers.
 *
 * This is the honest measure of exploration: the area actually uncovered on
 * the map, not the distance walked. Standing still for an hour adds nothing;
 * walking a new street adds the corridor the brush swept out.
 *
 * Each tile is measured at its own latitude. A Web Mercator cell covers less
 * ground the further it is from the equator, so a fixed reference latitude
 * would quietly overstate northern exploration — and, worse, give different
 * answers on different screens.
 */

import { popcount } from './bitmap';
import type { TileBitmap } from './geojson';
import { globalBitToLocation, metersPerBit, TILE_BITS } from './tiles';

export function exploredSquareMeters(tiles: TileBitmap[]): number {
  let total = 0;

  for (const tile of tiles) {
    const cells = popcount(tile.bitmap);
    if (cells === 0) continue;

    const centre = globalBitToLocation(
      tile.x * TILE_BITS + TILE_BITS / 2,
      tile.y * TILE_BITS + TILE_BITS / 2,
    );
    const cellSize = metersPerBit(centre.lat);

    total += cells * cellSize * cellSize;
  }

  return total;
}
