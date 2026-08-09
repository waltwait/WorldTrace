/**
 * Fog tile bitmaps.
 *
 * One tile is a 128x128 grid of bits packed row-major into 2048 bytes. A set
 * bit means "explored" — the fog overlay renders it transparent. Kept
 * deliberately allocation-free so painting a track does not churn the heap.
 */

import { TILE_BITS } from './tiles';

export const TILE_BYTES = (TILE_BITS * TILE_BITS) / 8;

/** A fully fogged tile. */
export function createTile(): Uint8Array {
  return new Uint8Array(TILE_BYTES);
}

function byteIndex(bx: number, by: number): number {
  return (by * TILE_BITS + bx) >> 3;
}

function bitMask(bx: number): number {
  return 1 << (bx & 7);
}

/** Whether the cell has been explored. */
export function getBit(tile: Uint8Array, bx: number, by: number): boolean {
  return (tile[byteIndex(bx, by)] & bitMask(bx)) !== 0;
}

/**
 * Mark a cell explored. Returns true only if this call changed it, which is
 * how newly explored area gets counted without rescanning the tile.
 */
export function setBit(tile: Uint8Array, bx: number, by: number): boolean {
  const index = byteIndex(bx, by);
  const mask = bitMask(bx);

  if ((tile[index] & mask) !== 0) return false;

  tile[index] |= mask;
  return true;
}

/** Number of explored cells in the tile. */
export function popcount(tile: Uint8Array): number {
  let total = 0;

  for (let i = 0; i < tile.length; i++) {
    let byte = tile[i];
    while (byte !== 0) {
      byte &= byte - 1;
      total++;
    }
  }

  return total;
}
