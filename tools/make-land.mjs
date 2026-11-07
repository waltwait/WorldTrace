#!/usr/bin/env node
/**
 * Writes src/flights/land.ts: the world's land, simplified, for drawing under the
 * flight arcs on a shared picture. It is only coastlines, the same for everyone, so
 * nothing personal reaches the picture (the fog map would show where you live).
 *
 *   node tools/make-land.mjs path/to/world-atlas/land-50m.json
 *
 * The source is world-atlas@2 (`npm pack world-atlas@2`), Natural Earth's 1:50m land
 * as TopoJSON. Each ring is simplified to about 0.05°, rings smaller than a few
 * hundredths of a square degree are dropped, and points are kept as hundredths of a
 * degree, each one the difference from the one before, which keeps the file small.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOLERANCE_DEG = 0.05;
const SMALLEST_AREA_DEG2 = 0.02;

const source = process.argv[2];
if (!source) {
  console.error('usage: node tools/make-land.mjs path/to/land-50m.json');
  process.exit(1);
}

const topology = JSON.parse(readFileSync(source, 'utf8'));
const { scale, translate } = topology.transform;

// TopoJSON arcs are quantised and delta-encoded.
const arcs = topology.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
});

function ringOf(indexes) {
  const ring = [];
  for (const index of indexes) {
    const arc = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
    // Each arc starts where the last one ended.
    ring.push(...(ring.length > 0 ? arc.slice(1) : arc));
  }
  return ring;
}

function area(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function simplify(points) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let farthest = -1;
    let distance = 0;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[i], points[first], points[last]);
      if (d > distance) {
        distance = d;
        farthest = i;
      }
    }
    if (farthest !== -1 && distance > TOLERANCE_DEG) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const rings = [];
for (const geometry of topology.objects.land.geometries) {
  const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
  for (const polygon of polygons) {
    for (const indexes of polygon) {
      const ring = ringOf(indexes);
      if (area(ring) < SMALLEST_AREA_DEG2) continue;
      const simple = simplify(ring);
      if (simple.length >= 4) rings.push(simple);
    }
  }
}

const encoded = rings.map((ring) => {
  let x = 0;
  let y = 0;
  const out = [];
  for (const [lon, lat] of ring) {
    const qx = Math.round(lon * 100);
    const qy = Math.round(lat * 100);
    out.push(qx - x, qy - y);
    x = qx;
    y = qy;
  }
  return `[${out.join(',')}]`;
});

const points = rings.reduce((sum, ring) => sum + ring.length, 0);
const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'flights', 'land.ts');

writeFileSync(
  target,
  `/**
 * The world's land, for drawing under the flight arcs. Made by tools/make-land.mjs
 * from world-atlas@2 land-50m (Natural Earth, public domain); do not edit by hand.
 * ${rings.length} rings, ${points} points.
 *
 * Each ring is a flat list of hundredths of a degree, longitude then latitude, each
 * pair the difference from the pair before it; see landRings in landShapes.ts.
 *
 * world-atlas: Copyright 2013-2019 Michael Bostock. Permission to use, copy, modify,
 * and/or distribute this software for any purpose with or without fee is hereby
 * granted, provided that the above copyright notice and this permission notice
 * appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS
 * ALL WARRANTIES WITH REGARD TO THIS SOFTWARE.
 */

export const LAND: readonly (readonly number[])[] = [
${encoded.join(',\n')},
];
`,
);

console.log(`${target}: ${rings.length} rings, ${points} points`);
