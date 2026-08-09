/**
 * Fog tile geometry.
 *
 * The fog lives on a fixed Web Mercator grid at zoom 16. Each tile carries a
 * 128x128 bitmap, so one bit covers roughly 4.8 m at the equator and about
 * 4.3 m at Taiwan's latitude. Everything here is pure arithmetic — no I/O, no
 * platform APIs — so it is fully testable off-device.
 */

export const FOG_ZOOM = 16;
export const TILE_BITS = 128;

/** Length of the equator in metres, WGS 84. */
const EQUATOR_METERS = 40075016.686;

/** Number of tiles along one axis of the grid at FOG_ZOOM. */
const GRID_TILES = 2 ** FOG_ZOOM;

/** Number of bits along one axis of the whole grid. */
const GRID_BITS = GRID_TILES * TILE_BITS;

export interface BitCoord {
  /** Tile column at FOG_ZOOM. */
  x: number;
  /** Tile row at FOG_ZOOM. */
  y: number;
  /** Bit column within the tile, 0..TILE_BITS-1. */
  bx: number;
  /** Bit row within the tile, 0..TILE_BITS-1. */
  by: number;
}

/** Ground distance covered by a single bit at the given latitude, in metres. */
export function metersPerBit(lat: number): number {
  return (EQUATOR_METERS * Math.cos((lat * Math.PI) / 180)) / GRID_BITS;
}

/** A position on the global bit grid, keeping sub-bit precision. */
export interface GlobalBit {
  gx: number;
  gy: number;
}

/**
 * Project a WGS 84 coordinate onto the global bit grid without rounding.
 *
 * Painting works in this space: Mercator is conformal, so locally one bit
 * covers the same ground distance on both axes, and a circular brush stays
 * circular.
 */
export function locationToGlobalBit(lat: number, lon: number): GlobalBit {
  const latRad = (lat * Math.PI) / 180;

  return {
    gx: ((lon + 180) / 360) * GRID_BITS,
    gy:
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      GRID_BITS,
  };
}

/**
 * The inverse of locationToGlobalBit — where a point on the bit grid sits on
 * the globe. Used to turn explored cells back into map geometry.
 */
export function globalBitToLocation(gx: number, gy: number): { lat: number; lon: number } {
  const mercatorY = Math.PI * (1 - (2 * gy) / GRID_BITS);

  return {
    lat: (Math.atan(Math.sinh(mercatorY)) * 180) / Math.PI,
    lon: (gx / GRID_BITS) * 360 - 180,
  };
}

/** Resolve a WGS 84 coordinate to the fog bit that contains it. */
export function locationToBit(lat: number, lon: number): BitCoord {
  const { gx, gy } = locationToGlobalBit(lat, lon);
  const x = Math.floor(gx / TILE_BITS);
  const y = Math.floor(gy / TILE_BITS);

  return {
    x,
    y,
    bx: Math.floor(gx) - x * TILE_BITS,
    by: Math.floor(gy) - y * TILE_BITS,
  };
}
