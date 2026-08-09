import { describe, expect, test } from 'vitest';
import { createTile, setBit } from './bitmap';
import { exploredRings, exploredFeature, fogFeature } from './geojson';
import { locationToBit, locationToGlobalBit, globalBitToLocation, TILE_BITS } from './tiles';

const TAIPEI = { lat: 25.033, lon: 121.5654 };
const TILE = locationToBit(TAIPEI.lat, TAIPEI.lon);

describe('exploredRings', () => {
  test('produces nothing for a fully fogged tile', () => {
    expect(exploredRings(TILE.x, TILE.y, createTile())).toEqual([]);
  });

  test('produces one ring for one explored cell', () => {
    const tile = createTile();
    setBit(tile, 10, 20);

    const rings = exploredRings(TILE.x, TILE.y, tile);

    expect(rings).toHaveLength(1);
    // A closed rectangle: five positions, first equal to last.
    expect(rings[0]).toHaveLength(5);
    expect(rings[0][0]).toEqual(rings[0][4]);
  });

  test('merges a horizontal run into a single ring', () => {
    const tile = createTile();
    for (let bx = 10; bx < 30; bx++) setBit(tile, bx, 20);

    expect(exploredRings(TILE.x, TILE.y, tile)).toHaveLength(1);
  });

  test('keeps separate runs on the same row apart', () => {
    const tile = createTile();
    setBit(tile, 10, 20);
    setBit(tile, 50, 20);

    expect(exploredRings(TILE.x, TILE.y, tile)).toHaveLength(2);
  });

  test('emits one ring per row, since rows are not merged vertically', () => {
    const tile = createTile();
    setBit(tile, 10, 20);
    setBit(tile, 10, 21);

    expect(exploredRings(TILE.x, TILE.y, tile)).toHaveLength(2);
  });

  test('places the ring at the cell it came from', () => {
    const tile = createTile();
    setBit(tile, TILE.bx, TILE.by);

    const [ring] = exploredRings(TILE.x, TILE.y, tile);
    const lons = ring.map(([lon]) => lon);
    const lats = ring.map(([, lat]) => lat);

    expect(Math.min(...lons)).toBeLessThanOrEqual(TAIPEI.lon);
    expect(Math.max(...lons)).toBeGreaterThanOrEqual(TAIPEI.lon);
    expect(Math.min(...lats)).toBeLessThanOrEqual(TAIPEI.lat);
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(TAIPEI.lat);
  });

  test('winds the ring counter-clockwise as GeoJSON requires for an exterior ring', () => {
    const tile = createTile();
    setBit(tile, 10, 20);

    const [ring] = exploredRings(TILE.x, TILE.y, tile);

    // Shoelace: positive area means counter-clockwise in lon/lat space.
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    expect(area).toBeGreaterThan(0);
  });

  test('spans the full width of the tile when every cell in a row is explored', () => {
    const tile = createTile();
    for (let bx = 0; bx < TILE_BITS; bx++) setBit(tile, bx, 0);

    const [ring] = exploredRings(TILE.x, TILE.y, tile);
    const lons = ring.map(([lon]) => lon);

    const left = globalBitToLocation(TILE.x * TILE_BITS, TILE.y * TILE_BITS);
    const right = globalBitToLocation((TILE.x + 1) * TILE_BITS, TILE.y * TILE_BITS);

    expect(Math.min(...lons)).toBeCloseTo(left.lon, 9);
    expect(Math.max(...lons)).toBeCloseTo(right.lon, 9);
  });
});

describe('exploredFeature', () => {
  test('is null when nothing has been explored', () => {
    expect(exploredFeature([{ x: TILE.x, y: TILE.y, bitmap: createTile() }])).toBeNull();
  });

  test('collects every tile into one MultiPolygon', () => {
    const a = createTile();
    setBit(a, 10, 20);
    const b = createTile();
    setBit(b, 30, 40);

    const feature = exploredFeature([
      { x: TILE.x, y: TILE.y, bitmap: a },
      { x: TILE.x + 1, y: TILE.y, bitmap: b },
    ]);

    expect(feature?.geometry.type).toBe('MultiPolygon');
    expect(feature?.geometry.coordinates).toHaveLength(2);
  });

  test('wraps each ring as its own polygon with no holes', () => {
    const tile = createTile();
    setBit(tile, 10, 20);

    const feature = exploredFeature([{ x: TILE.x, y: TILE.y, bitmap: tile }]);

    expect(feature?.geometry.coordinates[0]).toHaveLength(1);
  });
});

describe('fogFeature', () => {
  test('covers the whole world when nothing has been explored', () => {
    const feature = fogFeature([]);
    const [exterior] = feature.geometry.coordinates;
    const lons = exterior.map(([lon]) => lon);
    const lats = exterior.map(([, lat]) => lat);

    expect(feature.geometry.coordinates).toHaveLength(1);
    expect(Math.min(...lons)).toBeLessThanOrEqual(-180);
    expect(Math.max(...lons)).toBeGreaterThanOrEqual(180);
    expect(Math.min(...lats)).toBeLessThanOrEqual(-85);
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(85);
  });

  test('punches an explored cell out as a hole', () => {
    const tile = createTile();
    setBit(tile, 10, 20);

    const feature = fogFeature([{ x: TILE.x, y: TILE.y, bitmap: tile }]);

    expect(feature.geometry.coordinates).toHaveLength(2);
    expect(feature.geometry.coordinates[1]).toEqual(
      exploredRings(TILE.x, TILE.y, tile)[0],
    );
  });

  test('winds the exterior clockwise, opposite to the holes', () => {
    const shoelace = (ring: [number, number][]) => {
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      return area;
    };

    const tile = createTile();
    setBit(tile, 10, 20);
    const feature = fogFeature([{ x: TILE.x, y: TILE.y, bitmap: tile }]);

    expect(shoelace(feature.geometry.coordinates[0])).toBeLessThan(0);
    expect(shoelace(feature.geometry.coordinates[1])).toBeGreaterThan(0);
  });

  test('punches out every run across every tile', () => {
    const a = createTile();
    setBit(a, 10, 20);
    setBit(a, 50, 20);
    const b = createTile();
    setBit(b, 30, 40);

    const feature = fogFeature([
      { x: TILE.x, y: TILE.y, bitmap: a },
      { x: TILE.x + 1, y: TILE.y, bitmap: b },
    ]);

    expect(feature.geometry.coordinates).toHaveLength(4);
  });
});
