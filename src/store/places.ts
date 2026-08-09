/**
 * Which countries and cities the explored ground falls in.
 *
 * Resolved a tile at a time, lazily, and remembered forever. Reverse geocoding
 * needs the network and is rate-limited by the platform, so this is built to do
 * a little on each launch and eventually catch up rather than to answer
 * immediately — and to survive being offline for weeks by simply not
 * progressing, never by losing what it already knows.
 */

import { FOG_ZOOM } from '../fog/tiles';
import type { SqlDriver } from './driver';

export interface TileRef {
  x: number;
  y: number;
}

export interface Place {
  country: string | null;
  city: string | null;
}

export interface PlaceCounts {
  countries: number;
  cities: number;
}

/**
 * Explored tiles with no answer yet, newest ground first.
 *
 * Newest first because where you have just been is what you want named. A tile
 * that resolved to nothing counts as answered — retrying it forever would spend
 * every pass on the same stretch of coast.
 */
export async function unresolvedTiles(driver: SqlDriver, limit: number): Promise<TileRef[]> {
  return driver.all<TileRef>(
    `SELECT f.x, f.y
       FROM fog_tiles f
       LEFT JOIN tile_places p ON p.z = f.z AND p.x = f.x AND p.y = f.y
      WHERE f.z = ? AND p.z IS NULL
      ORDER BY f.updated_at DESC
      LIMIT ?`,
    [FOG_ZOOM, limit],
  );
}

export async function recordPlace(
  driver: SqlDriver,
  tile: TileRef,
  place: Place,
  resolvedAt: number,
): Promise<void> {
  await driver.run(
    `INSERT INTO tile_places (z, x, y, country, city, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (z, x, y) DO UPDATE SET
       country = excluded.country,
       city = excluded.city,
       resolved_at = excluded.resolved_at`,
    [FOG_ZOOM, tile.x, tile.y, place.country, place.city, resolvedAt],
  );
}

/** Every distinct place, for a list. */
export async function listPlaces(driver: SqlDriver): Promise<Place[]> {
  return driver.all<Place>(
    `SELECT DISTINCT country, city FROM tile_places
      WHERE country IS NOT NULL
      ORDER BY country, city`,
  );
}

export async function countPlaces(driver: SqlDriver): Promise<PlaceCounts> {
  // Cities are counted per country. Two Springfields in different countries are
  // two cities; the same city named by two tiles is one.
  const row = await driver.get<{ countries: number; cities: number }>(
    `SELECT COUNT(DISTINCT country) AS countries,
            COUNT(DISTINCT CASE WHEN city IS NOT NULL THEN country || '/' || city END) AS cities
       FROM tile_places
      WHERE country IS NOT NULL`,
  );

  return { countries: row?.countries ?? 0, cities: row?.cities ?? 0 };
}
