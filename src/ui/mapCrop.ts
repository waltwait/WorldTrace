/**
 * Where the map sits inside the tile on the first page.
 *
 * The map is always the size of the screen, and the tile only shows the middle of
 * it. Growing the map itself to open it made MapLibre rebuild its surface, and the
 * wider view the fog no longer served, so opening it redrew the fog as well: seconds
 * on the JS thread, then the map starting its tiles again. Opening it now only
 * uncovers what is already drawn.
 */

export interface Size {
  width: number;
  height: number;
}

/**
 * The size to keep for the map. Only grows, for one width: the keyboard shrinks the
 * window, and a map following it rebuilt its surface and redrew the fog each time it
 * opened or closed, in the middle of whatever was animating over the top.
 */
export function steadySize(current: Size, next: Size): Size {
  if (next.width !== current.width) return next;
  return next.height > current.height ? next : current;
}

export function cropOffset(tile: Size, map: Size): { left: number; top: number } {
  return { left: (tile.width - map.width) / 2, top: (tile.height - map.height) / 2 };
}
