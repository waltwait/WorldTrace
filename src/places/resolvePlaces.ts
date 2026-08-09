/**
 * Turning explored tiles into country and city names.
 *
 * The platform geocoder needs the network and throttles callers hard, so this
 * takes a small bite each time it runs and lets the rest wait for the next
 * launch. Nothing here is urgent: a tile you walked through last month is just
 * as nameable next week.
 *
 * Everything that could be got wrong — which tiles are still outstanding, how a
 * result is stored, how the counts are derived — lives in store/places.ts and
 * is tested. This file is the part that needs a phone and a network, so it is
 * kept to the smallest thing that could work.
 */

import * as Location from 'expo-location';
import { globalBitToLocation, TILE_BITS } from '../fog/tiles';
import type { SqlDriver } from '../store/driver';
import { recordPlace, unresolvedTiles, type Place, type TileRef } from '../store/places';

/**
 * How many tiles to name per pass.
 *
 * Android's geocoder starts refusing after a burst, and a refusal recorded as
 * "nowhere" would be remembered as fact. Small enough to stay well under it.
 */
const TILES_PER_PASS = 12;

/** The middle of a tile, in degrees. */
function centreOf(tile: TileRef): { latitude: number; longitude: number } {
  const { lat, lon } = globalBitToLocation(
    tile.x * TILE_BITS + TILE_BITS / 2,
    tile.y * TILE_BITS + TILE_BITS / 2,
  );

  return { latitude: lat, longitude: lon };
}

/**
 * Name a few more tiles.
 *
 * Returns how many were resolved, and stops at the first sign of throttling —
 * pushing on would turn every remaining tile into a permanent "nowhere".
 */
export async function resolvePlaces(driver: SqlDriver): Promise<number> {
  const tiles = await unresolvedTiles(driver, TILES_PER_PASS);
  if (tiles.length === 0) return 0;

  let resolved = 0;

  for (const tile of tiles) {
    let place: Place;

    try {
      const [first] = await Location.reverseGeocodeAsync(centreOf(tile));
      place = first
        ? { country: first.country ?? null, city: first.city ?? first.subregion ?? null }
        : { country: null, city: null };
    } catch {
      // Offline, or throttled. Record nothing and stop: a failure written down
      // as "nowhere" would never be retried, and the tile would be wrong
      // forever.
      break;
    }

    await recordPlace(driver, tile, place, Date.now());
    resolved++;
  }

  return resolved;
}
