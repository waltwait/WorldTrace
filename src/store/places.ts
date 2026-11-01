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
 * How far from every named tile, in tiles, ground has to be to count as new at
 * each step, widest first. About 35 km, 9 km and 2 km at the latitude of Taiwan.
 */
const NEW_GROUND = [64, 16, 4];

/**
 * Tiles bucketed in a grid, so "is anything within this distance" looks at nine
 * cells rather than at every tile. The grid only speeds the question up; the
 * answer is the distance.
 */
class Nearby {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly reach: number) {}

  private cell(x: number, y: number): number {
    return Math.floor(x / this.reach) * 65536 + Math.floor(y / this.reach);
  }

  add(tile: TileRef): void {
    const key = this.cell(tile.x, tile.y);
    const bucket = this.cells.get(key);
    const packed = tile.x * 65536 + tile.y;

    if (bucket) bucket.push(packed);
    else this.cells.set(key, [packed]);
  }

  /** Whether any added tile is closer than `reach` tiles, in either direction. */
  hasWithin(tile: TileRef): boolean {
    const cx = Math.floor(tile.x / this.reach);
    const cy = Math.floor(tile.y / this.reach);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get((cx + dx) * 65536 + (cy + dy));
        if (!bucket) continue;

        for (const packed of bucket) {
          const x = Math.floor(packed / 65536);
          const y = packed % 65536;
          if (Math.max(Math.abs(x - tile.x), Math.abs(y - tile.y)) < this.reach) return true;
        }
      }
    }

    return false;
  }
}

/**
 * Explored tiles with no answer yet, new ground first.
 *
 * Each pass names only a handful of tiles, so which ones matters more than how
 * fast. What the counts want is the places nothing has been named near yet: a
 * tile in a country not yet on the list says more than the thousandth tile of a
 * city already known. So a tile with no named tile within 64 tiles of it comes
 * first, then one with none within 16, then within 4, and the newest tile of
 * each such stretch before any second one. A tile counts as named the moment it
 * is chosen, so a pass spreads over new ground instead of piling onto one
 * stretch of it. Once everything has an answer nearby, it is newest first.
 *
 * It used to be newest first throughout, by when a tile was last touched. A
 * rebuild or a redraw refreshes that for swathes of old ground at once, so ground
 * just walked in another country queued behind hundreds of tiles at home: fifty
 * launches of twelve before the first foreign tile was named.
 *
 * A tile that resolved to nothing counts as answered — retrying it forever would
 * spend every pass on the same stretch of coast.
 */
export async function unresolvedTiles(driver: SqlDriver, limit: number): Promise<TileRef[]> {
  if (limit <= 0) return [];

  const waiting = await driver.all<TileRef>(
    `SELECT f.x, f.y
       FROM fog_tiles f
       LEFT JOIN tile_places p ON p.z = f.z AND p.x = f.x AND p.y = f.y
      WHERE f.z = ? AND p.z IS NULL
      ORDER BY f.updated_at DESC`,
    [FOG_ZOOM],
  );
  if (waiting.length === 0) return [];

  const named = await driver.all<TileRef>('SELECT x, y FROM tile_places WHERE z = ?', [FOG_ZOOM]);

  const nearby = NEW_GROUND.map((reach) => new Nearby(reach));
  const markNamed = (tile: TileRef) => nearby.forEach((grid) => grid.add(tile));
  named.forEach(markNamed);

  const chosen: TileRef[] = [];
  const chosenKeys = new Set<number>();
  const choose = (tile: TileRef) => {
    chosen.push({ x: tile.x, y: tile.y });
    chosenKeys.add(tile.x * 65536 + tile.y);
    markNamed(tile);
  };

  for (let step = 0; step < NEW_GROUND.length && chosen.length < limit; step++) {
    for (const tile of waiting) {
      if (chosen.length >= limit) break;
      if (!nearby[step].hasWithin(tile)) choose(tile);
    }
  }

  for (const tile of waiting) {
    if (chosen.length >= limit) break;
    if (!chosenKeys.has(tile.x * 65536 + tile.y)) choose(tile);
  }

  return chosen;
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
