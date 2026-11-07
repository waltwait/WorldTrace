/**
 * Pure spherical Great Circle arc projection into a fixed 2D card panel.
 *
 * Privacy-safe by construction: reads only airport coordinates on flights, and under
 * them the world's coastlines (landShapes.ts), the same for everyone; never fog tiles
 * or street maps, so home neighbourhoods never appear on shared images.
 */

import { buildGreatCircleArc, flightEnds } from './greatCircle';
import { landRings } from './landShapes';
import type { FlightRecord } from './types';

export interface ProjectedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ProjectedAirport {
  iata: string;
  x: number;
  y: number;
}

export interface ProjectedLabel {
  iata: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ProjectedRing = ReadonlyArray<readonly [number, number]>;

export interface ArcDiagramLayout {
  width: number;
  height: number;
  gridLines: ProjectedLine[];
  /** The land in view, in panel points: without it nobody can tell where an arc goes. */
  land: ProjectedRing[];
  groundLinks: ProjectedLine[];
  arcs: string[];
  airports: ProjectedAirport[];
  labels: ProjectedLabel[];
}

export interface ArcDiagramOptions {
  /** Connect consecutive flights that change airports on the ground (e.g. NRT -> KIX). */
  connectGround?: boolean;
  /** Place collision-free IATA badges next to airports (used on single-trip cards). */
  showLabels?: boolean;
}

function circularMeanDeg(lons: readonly number[]): number {
  let sinSum = 0;
  let cosSum = 0;
  for (const lon of lons) {
    const rad = (lon * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  if (Math.abs(sinSum) < 1e-9 && Math.abs(cosSum) < 1e-9) return lons[0] ?? 0;
  return (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
}

function wrapNear(lon: number, anchor: number): number {
  let out = lon;
  while (out - anchor > 180) out -= 360;
  while (out - anchor < -180) out += 360;
  return out;
}

function fmt(n: number): string {
  return n.toFixed(1);
}

/** Rings as one SVG path, each closed. */
export function ringsPath(rings: readonly ProjectedRing[]): string {
  return rings
    .map((ring) => `M${ring.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`)
    .join('');
}

/**
 * Every ring of land that reaches into the panel. A ring is moved by whole turns to sit
 * beside the middle of the view, as the arcs are, so over the Pacific America is drawn
 * east of Asia rather than a world away.
 */
function landInView(
  project: (lon: number, lat: number) => [number, number],
  midLon: number,
  width: number,
  height: number,
): ProjectedRing[] {
  const shown: ProjectedRing[] = [];
  for (const ring of landRings()) {
    const meanLon = ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length;
    const shift = wrapNear(meanLon, midLon) - meanLon;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const points = ring.map(([lon, lat]) => {
      const point = project(lon + shift, lat);
      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
      return point;
    });

    if (maxX < 0 || minX > width || maxY < 0 || minY > height) continue;
    shown.push(points);
  }
  return shown;
}

export function projectFlightArcs(
  flights: readonly FlightRecord[],
  size: { width: number; height: number },
  options: ArcDiagramOptions = {},
): ArcDiagramLayout | null {
  const { width, height } = size;
  if (width <= 0 || height <= 0) return null;

  const positioned = flights
    .map((flight) => {
      const ends = flightEnds(flight);
      return ends
        ? {
            depIata: flight.depIata,
            arrIata: flight.arrIata,
            dep: ends.dep,
            arr: ends.arr,
          }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (positioned.length === 0) return null;

  const anchorLon = circularMeanDeg(
    positioned.flatMap((p) => [p.dep.lon, p.arr.lon]),
  );

  // Align every great-circle arc near `anchorLon` so outbound and return trans-Pacific
  // flights sit together across the Pacific rather than 360° apart.
  const rawArcs = positioned.map((leg) => {
    const pts = buildGreatCircleArc(leg.dep, leg.arr, 40);
    const midIdx = Math.floor(pts.length / 2);
    const midLon = pts[midIdx][0];
    const shift = wrapNear(midLon, anchorLon) - midLon;
    return {
      depIata: leg.depIata,
      arrIata: leg.arrIata,
      pts: pts.map(([lon, lat]) => [lon + shift, lat] as [number, number]),
    };
  });

  const rawGround: Array<{ a: [number, number]; b: [number, number] }> = [];
  if (options.connectGround) {
    for (let i = 1; i < rawArcs.length; i++) {
      const prev = rawArcs[i - 1];
      const next = rawArcs[i];
      if (prev.arrIata !== next.depIata) {
        const a = prev.pts[prev.pts.length - 1];
        const bLon = wrapNear(next.pts[0][0], a[0]);
        rawGround.push({ a, b: [bLon, next.pts[0][1]] });
      }
    }
  }

  const allPts = [
    ...rawArcs.flatMap((a) => a.pts),
    ...rawGround.flatMap((g) => [g.a, g.b]),
  ];
  const lons = allPts.map((p) => p[0]);
  const lats = allPts.map((p) => p[1]);
  const rawMinLon = Math.min(...lons);
  const rawMaxLon = Math.max(...lons);
  const rawMinLat = Math.min(...lats);
  const rawMaxLat = Math.max(...lats);

  const midLon = (rawMinLon + rawMaxLon) / 2;
  const midLat = (rawMinLat + rawMaxLat) / 2;
  const cosLat = Math.max(0.25, Math.cos((midLat * Math.PI) / 180));

  const dataW = Math.max((rawMaxLon - rawMinLon) * cosLat * 1.56, 5.5);
  const dataH = Math.max((rawMaxLat - rawMinLat) * 1.78, 5.5);
  const panelAspect = width / height;
  const viewW = Math.max(dataW, dataH * panelAspect);
  const viewH = Math.max(dataH, dataW / panelAspect);
  const scale = width / viewW;

  const project = (lon: number, lat: number): [number, number] => [
    width / 2 + (lon - midLon) * cosLat * scale,
    height / 2 - (lat - midLat) * scale,
  ];

  // Full-bleed graticule across the entire panel
  const stepDeg = viewH > 26 ? 10 : 5;
  const minVisLon = midLon - (viewW / cosLat) * 0.6;
  const maxVisLon = midLon + (viewW / cosLat) * 0.6;
  const minVisLat = midLat - viewH * 0.6;
  const maxVisLat = midLat + viewH * 0.6;

  const gridLines: ProjectedLine[] = [];
  for (let glon = Math.floor(minVisLon / stepDeg) * stepDeg; glon <= maxVisLon; glon += stepDeg) {
    const [gx] = project(glon, midLat);
    if (gx >= 0 && gx <= width) {
      gridLines.push({ x1: gx, y1: 0, x2: gx, y2: height });
    }
  }
  for (let glat = Math.floor(minVisLat / stepDeg) * stepDeg; glat <= maxVisLat; glat += stepDeg) {
    const [, gy] = project(midLon, glat);
    if (gy >= 0 && gy <= height) {
      gridLines.push({ x1: 0, y1: gy, x2: width, y2: gy });
    }
  }

  const groundLinks: ProjectedLine[] = rawGround.map(({ a, b }) => {
    const [x1, y1] = project(a[0], a[1]);
    const [x2, y2] = project(b[0], b[1]);
    return { x1, y1, x2, y2 };
  });

  // Deduplicate identical undirected segments when building multi-trip maps so a route flown
  // five times does not stack five identical strokes into a thick blob.
  const seenArcKeys = new Set<string>();
  const arcs: string[] = [];
  for (const arc of rawArcs) {
    const start = arc.pts[0];
    const end = arc.pts[arc.pts.length - 1];
    const [sx, sy] = project(start[0], start[1]);
    const [ex, ey] = project(end[0], end[1]);
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.hypot(dx, dy);

    // Subtle upward visual loft so short low-latitude routes read as airborne arcs
    let nx = -dy / Math.max(dist, 1);
    let ny = dx / Math.max(dist, 1);
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const maxAllowedLift = Math.max(0, Math.min(sy, ey) - 10);
    const lift = Math.min(Math.min(Math.max(dist * 0.13, 6), 20), maxAllowedLift);

    // On single-trip cards (`showLabels`), slightly vary outbound vs inbound lift so
    // a round trip reads as two distinct flight paths rather than one line.
    const pairKey = [arc.depIata, arc.arrIata].sort().join('-');
    const seenBefore = seenArcKeys.has(pairKey);
    seenArcKeys.add(pairKey);
    if (!options.showLabels && seenBefore) continue;
    const effectiveLift = options.showLabels && seenBefore ? lift * 0.62 : lift;

    const commands = arc.pts.map(([lon, lat], idx) => {
      const t = idx / Math.max(1, arc.pts.length - 1);
      const bell = Math.sin(t * Math.PI);
      const [bx, by] = project(lon, lat);
      const px = bx + nx * effectiveLift * bell;
      const py = by + ny * effectiveLift * bell;
      return `${idx === 0 ? 'M' : 'L'}${fmt(px)} ${fmt(py)}`;
    });
    arcs.push(commands.join(' '));
  }

  // Unique airport dots in order of appearance
  const airportByCode = new Map<string, { iata: string; lon: number; lat: number; x: number; y: number }>();
  for (const arc of rawArcs) {
    const start = arc.pts[0];
    const end = arc.pts[arc.pts.length - 1];
    if (!airportByCode.has(arc.depIata)) {
      const [x, y] = project(start[0], start[1]);
      airportByCode.set(arc.depIata, { iata: arc.depIata, lon: start[0], lat: start[1], x, y });
    }
    if (!airportByCode.has(arc.arrIata)) {
      const [x, y] = project(end[0], end[1]);
      airportByCode.set(arc.arrIata, { iata: arc.arrIata, lon: end[0], lat: end[1], x, y });
    }
  }

  const airports: ProjectedAirport[] = Array.from(airportByCode.values()).map(({ iata, x, y }) => ({
    iata,
    x,
    y,
  }));

  const labels: ProjectedLabel[] = [];
  if (options.showLabels) {
    const labelW = 34;
    const labelH = 16;
    for (const ap of airportByCode.values()) {
      const candidates: Array<[number, number]> =
        ap.lat < midLat
          ? [
              [0, 8],
              [-23, 4],
              [23, 4],
              [0, -23],
            ]
          : [
              [0, -23],
              [23, -15],
              [-23, -15],
              [0, 8],
            ];

      for (const [ox, oy] of candidates) {
        const lx = ap.x + ox - labelW / 2;
        const ly = ap.y + oy;
        const inside = lx >= 4 && lx + labelW <= width - 4 && ly >= 4 && ly + labelH <= height - 4;
        if (!inside) continue;

        const collidesLabel = labels.some(
          (other) =>
            lx - 2 < other.x + other.width &&
            lx + labelW + 2 > other.x &&
            ly - 1 < other.y + other.height &&
            ly + labelH + 1 > other.y,
        );
        if (collidesLabel) continue;

        const hitsDot = airports.some(
          (other) =>
            other.iata !== ap.iata &&
            other.x >= lx - 3 &&
            other.x <= lx + labelW + 3 &&
            other.y >= ly - 3 &&
            other.y <= ly + labelH + 3,
        );
        if (hitsDot) continue;

        labels.push({ iata: ap.iata, x: lx, y: ly, width: labelW, height: labelH });
        break;
      }
    }
  }

  return {
    width,
    height,
    gridLines,
    land: landInView(project, midLon, width, height),
    groundLinks,
    arcs,
    airports,
    labels,
  };
}
