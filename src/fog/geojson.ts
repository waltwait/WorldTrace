/**
 * Turning fog bitmaps into map geometry.
 *
 * MapLibre draws the explored area as a filled shape punched out of a dark
 * overlay, so the bitmaps have to become polygons. Cells are merged along each
 * row and vertically across adjacent matching rows before being emitted,
 * collapsing walked paths from thousands of separate 1-row slivers into large
 * cohesive rectangles. This drastically reduces the hole count in GeoJSON
 * polygons, eliminating tile-slicing and triangulation lag during rapid map zooms.
 */

import { TILE_BITS, globalBitToLocation } from './tiles';

export type Position = [number, number];
export type Ring = Position[];

export interface TileBitmap {
  x: number;
  y: number;
  bitmap: Uint8Array;
}

export interface MultiPolygonFeature {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: {
    type: 'MultiPolygon';
    coordinates: Ring[][];
  };
}

/**
 * The world, wound clockwise so that the counter-clockwise explored rings
 * read as holes in it. Latitude stops just short of the poles because Web
 * Mercator cannot represent them.
 */
export const WORLD_RING: Ring = [
  [-180, -85.051129],
  [-180, 85.051129],
  [180, 85.051129],
  [180, -85.051129],
  [-180, -85.051129],
];

/**
 * The fog itself: the world with every explored cell punched out of it. This is
 * what gets drawn — the map shows through the holes, everything else stays
 * covered.
 *
 * A MultiPolygon rather than one polygon because ground can be fogged *inside*
 * explored ground: walk round a block and the loop is explored while the block
 * is not. That pocket is fog again, and a hole in a hole cannot be written in a
 * single Polygon — it has to be a polygon of its own, sitting inside the hole.
 */
export function fogFeature(tiles: TileBitmap[]): MultiPolygonFeature {
  const outlines: Ring[] = [];
  const pockets: Ring[][] = [];

  for (const tile of tiles) {
    const trace = traceTile(tile.x, tile.y, tile.bitmap);
    for (const outline of trace.outlines) outlines.push(outline);
    for (const pocket of trace.pockets) pockets.push(pocket);
  }

  return fogOf([[WORLD_RING, ...outlines], ...pockets]);
}

export function fogOf(polygons: Ring[][]): MultiPolygonFeature {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  };
}

/** What tracing one tile produces; see traceTile. */
export interface TileTrace {
  /**
   * Outer boundaries of explored ground that nothing else encloses. Wound
   * counter-clockwise, so in the fog they read as holes.
   */
  outlines: Ring[];
  /**
   * Fog sealed inside explored ground: the boundary of the pocket first, then
   * the outlines of any explored ground standing inside it. Wound clockwise,
   * like the world, with those inner outlines as its holes.
   */
  pockets: Ring[][];
}

/**
 * The tile as one byte per block, 1 where any cell in the block is explored.
 * Walks the set bits rather than every cell: a tile is mostly fog.
 */
function cellsOf(bitmap: Uint8Array, scale: number): Uint8Array {
  const blocks = TILE_BITS / scale;
  const cells = new Uint8Array(blocks * blocks);
  const bytesPerRow = TILE_BITS >> 3;

  for (let i = 0; i < bitmap.length; i++) {
    const byte = bitmap[i];
    if (byte === 0) continue;

    const row = Math.floor(i / bytesPerRow);
    const firstColumn = (i % bytesPerRow) << 3;
    const blockRow = Math.floor(row / scale) * blocks;

    for (let bit = 0; bit < 8; bit++) {
      if ((byte & (1 << bit)) !== 0) cells[blockRow + Math.floor((firstColumn + bit) / scale)] = 1;
    }
  }

  return cells;
}

interface Contour {
  ring: Ring;
  /** Explored ground inside (counter-clockwise), as opposed to a pocket of fog. */
  outer: boolean;
  /** Index of the contour that directly encloses this one, or -1 for none. */
  parent: number;
}

/**
 * The explored cells of one tile, as closed boundary rings in lon/lat.
 *
 * Every boundary between an explored cell and a fogged one is walked once, with
 * the explored side always on the left. That makes the outside of a patch of
 * explored ground wind counter-clockwise and the edge of a pocket inside it
 * wind clockwise, so orientation alone says which is which.
 *
 * Both kinds matter. The pockets used to be thrown away, and a route that came
 * back round on itself then cleared every cell it enclosed, walked or not.
 *
 * Uses 2D grid contour tracing (Eulerian boundary cycles) with collinear vertex
 * pruning. Instead of breaking connected explored paths into thousands of
 * adjacent 1-row slices, continuous paths are traced into smooth, unified
 * polygon boundaries.
 */
function contoursOf(x: number, y: number, bitmap: Uint8Array, scale: number): Contour[] {
  const W = TILE_BITS / scale;
  const H = TILE_BITS / scale;
  const originX = x * TILE_BITS;
  const originY = y * TILE_BITS;
  const cells = cellsOf(bitmap, scale);

  // Horizontal edges: (H + 1) * W.
  // 1: East  ((x, y) -> (x + 1, y))
  // 2: West  ((x + 1, y) -> (x, y))
  const hEdges = new Uint8Array((H + 1) * W);

  // Vertical edges: (W + 1) * H.
  // 1: North ((x, y + 1) -> (x, y))
  // 2: South ((x, y) -> (x, y + 1))
  const vEdges = new Uint8Array((W + 1) * H);

  let hasAnyExplored = false;

  for (let by = 0; by <= H; by++) {
    for (let bx = 0; bx < W; bx++) {
      const above = by > 0 && cells[(by - 1) * W + bx] === 1;
      const below = by < H && cells[by * W + bx] === 1;
      if (above) hasAnyExplored = true;

      if (above && !below) {
        hEdges[by * W + bx] = 1; // East
      } else if (!above && below) {
        hEdges[by * W + bx] = 2; // West
      }
    }
  }

  if (!hasAnyExplored) return [];

  for (let by = 0; by < H; by++) {
    for (let bx = 0; bx <= W; bx++) {
      const left = bx > 0 && cells[by * W + bx - 1] === 1;
      const right = bx < W && cells[by * W + bx] === 1;

      if (left && !right) {
        vEdges[by * (W + 1) + bx] = 1; // North
      } else if (!left && right) {
        vEdges[by * (W + 1) + bx] = 2; // South
      }
    }
  }

  // Which ring walked each edge, 1-based; zero means not walked yet. Rings are
  // remembered per edge because working out what encloses a ring later needs to
  // ask whose boundary a given edge is.
  const hOwner = new Uint16Array((H + 1) * W);
  const vOwner = new Uint16Array((W + 1) * H);

  interface Walked {
    corners: Array<{ x: number; y: number }>;
    outer: boolean;
    /** The left-most vertical edge, where the search for an enclosing ring starts. */
    anchorX: number;
    anchorRow: number;
  }
  const walked: Walked[] = [];

  // Directions: 0: East (+X), 1: North (-Y), 2: West (-X), 3: South (+Y)
  const available = (dir: number, curX: number, curY: number): boolean => {
    if (dir === 0) {
      return curX < W && hEdges[curY * W + curX] === 1 && hOwner[curY * W + curX] === 0;
    }
    if (dir === 1) {
      const i = (curY - 1) * (W + 1) + curX;
      return curY > 0 && vEdges[i] === 1 && vOwner[i] === 0;
    }
    if (dir === 2) {
      const i = curY * W + (curX - 1);
      return curX > 0 && hEdges[i] === 2 && hOwner[i] === 0;
    }
    const i = curY * (W + 1) + curX;
    return curY < H && vEdges[i] === 2 && vOwner[i] === 0;
  };

  for (let startY = 0; startY <= H; startY++) {
    for (let startX = 0; startX < W; startX++) {
      const hIdx = startY * W + startX;
      if (hEdges[hIdx] === 0 || hOwner[hIdx] !== 0) continue;

      let curX: number;
      let curY: number;
      let curDir: number;

      if (hEdges[hIdx] === 1) {
        curX = startX;
        curY = startY;
        curDir = 0; // East
      } else {
        curX = startX + 1;
        curY = startY;
        curDir = 2; // West
      }

      const id = walked.length + 1;
      const startXCoord = curX;
      const startYCoord = curY;
      const loopStartDir = curDir;
      let lastDir = curDir;
      let anchorX = Infinity;
      let anchorRow = 0;

      // Start the vertex list with the initial corner
      const vertices: Array<{ x: number; y: number }> = [{ x: curX, y: curY }];

      while (true) {
        // Traverse current edge and mark it as this ring's
        if (curDir === 0) {
          hOwner[curY * W + curX] = id;
          curX += 1;
        } else if (curDir === 1) {
          vOwner[(curY - 1) * (W + 1) + curX] = id;
          if (curX < anchorX) {
            anchorX = curX;
            anchorRow = curY - 1;
          }
          curY -= 1;
        } else if (curDir === 2) {
          hOwner[curY * W + (curX - 1)] = id;
          curX -= 1;
        } else {
          vOwner[curY * (W + 1) + curX] = id;
          if (curX < anchorX) {
            anchorX = curX;
            anchorRow = curY;
          }
          curY += 1;
        }

        lastDir = curDir;

        // Loop closed?
        if (curX === startXCoord && curY === startYCoord) {
          break;
        }

        // Next edge: turn left first (towards the explored side), then straight,
        // then right. Taking the left turn at a corner shared by two diagonal
        // cells keeps each cell's ring its own.
        const left = (curDir + 1) & 3;
        const right = (curDir + 3) & 3;
        let nextDir: number | null = null;

        if (available(left, curX, curY)) nextDir = left;
        else if (available(curDir, curX, curY)) nextDir = curDir;
        else if (available(right, curX, curY)) nextDir = right;

        if (nextDir === null) {
          // Safety guard: if no unvisited edge available, break
          break;
        }

        // If turning, record corner vertex
        if (nextDir !== curDir) {
          vertices.push({ x: curX, y: curY });
          curDir = nextDir;
        }
      }

      // If loop started on a straight line and ended on the same direction,
      // the initial point was not a corner; drop it.
      if (loopStartDir === lastDir && vertices.length > 1) {
        vertices.shift();
      }

      // Need at least 3 corners to form a polygon
      if (vertices.length < 3) continue;

      // Shoelace on the grid, whose y axis runs down the page: a negative sum is
      // counter-clockwise as drawn, which is how explored ground winds.
      let twiceArea = 0;
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        twiceArea += a.x * b.y - b.x * a.y;
      }

      walked.push({ corners: vertices, outer: twiceArea < 0, anchorX, anchorRow });
    }
  }

  // What lies directly west of each ring's left-most edge decides what encloses
  // it, found by walking along the row to the first edge in the way. That edge's
  // ring is either the enclosing one itself, or a sibling standing in the same
  // ground, in which case the sibling's parent is ours too.
  const parents = walked.map((ring, index) => {
    let neighbour = -1;
    const row = ring.anchorRow * (W + 1);

    for (let edgeX = ring.anchorX - 1; edgeX >= 0; edgeX--) {
      const owner = vOwner[row + edgeX];
      if (owner !== 0) {
        neighbour = owner - 1;
        break;
      }
    }

    return neighbour === -1 ? { hit: -1, index } : { hit: neighbour, index };
  });

  const parentOf = (index: number): number => {
    let current = index;

    // Each hop lands on a ring whose left-most edge lies strictly further west,
    // so this always ends.
    while (true) {
      const { hit } = parents[current];
      if (hit === -1) return -1;
      if (walked[hit].outer !== walked[current].outer) return hit;
      current = hit;
    }
  };

  // Grid lines map to the same lon or lat all the way along them, so the
  // conversion is done once per line and not once per corner.
  const lons: number[] = [];
  const lats: number[] = [];
  for (let i = 0; i <= W; i++) lons.push(globalBitToLocation(originX + i * scale, originY).lon);
  for (let i = 0; i <= H; i++) lats.push(globalBitToLocation(originX, originY + i * scale).lat);

  return walked.map((ring, index) => {
    const closed = [...ring.corners, ring.corners[0]];

    return {
      ring: closed.map((v): Position => [lons[v.x], lats[v.y]]),
      outer: ring.outer,
      parent: parentOf(index),
    };
  });
}

/**
 * One tile's fog geometry, with explored ground and the fog sealed inside it
 * kept in their proper places.
 *
 * `scale` traces on a coarser grid, `scale` cells to a block: 1 is every cell,
 * 128 is the whole tile as one. A block counts as explored if any cell in it is,
 * so coarsening can only ever show more ground than was walked, never less.
 */
export function traceTile(
  x: number,
  y: number,
  bitmap: Uint8Array,
  scale: number = 1,
): TileTrace {
  const contours = contoursOf(x, y, bitmap, scale);

  const outlines: Ring[] = [];
  const pockets: Ring[][] = [];
  const pocketIndex = new Map<number, number>();

  contours.forEach((contour, index) => {
    if (contour.outer) return;
    pocketIndex.set(index, pockets.length);
    pockets.push([contour.ring]);
  });

  for (const contour of contours) {
    if (!contour.outer) continue;
    if (contour.parent === -1) outlines.push(contour.ring);
    else pockets[pocketIndex.get(contour.parent)!].push(contour.ring);
  }

  return { outlines, pockets };
}

/**
 * The outer boundary of every patch of explored ground in a tile, however deep
 * inside a pocket it stands. Does not say what is inside each one; for that see
 * traceTile.
 */
export function exploredRings(x: number, y: number, bitmap: Uint8Array): Ring[] {
  return contoursOf(x, y, bitmap, 1)
    .filter((contour) => contour.outer)
    .map((contour) => contour.ring);
}

/**
 * Every explored cell across a set of tiles, as one feature ready to hand to
 * a MapLibre shape source. Null when nothing has been explored — an empty
 * MultiPolygon renders as a stray artefact on some styles.
 *
 * Ground that wraps round a pocket of fog is one polygon with the pocket as its
 * hole; ground standing inside that pocket is a polygon of its own.
 */
export function exploredFeature(tiles: TileBitmap[]): MultiPolygonFeature | null {
  const polygons: Ring[][] = [];

  for (const tile of tiles) {
    const contours = contoursOf(tile.x, tile.y, tile.bitmap, 1);
    const polygonOf = new Map<number, Ring[]>();

    contours.forEach((contour, index) => {
      if (!contour.outer) return;
      const polygon = [contour.ring];
      polygonOf.set(index, polygon);
      polygons.push(polygon);
    });

    for (const contour of contours) {
      if (!contour.outer) polygonOf.get(contour.parent)!.push(contour.ring);
    }
  }

  if (polygons.length === 0) return null;

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  };
}
