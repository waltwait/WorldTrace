/**
 * GPX export.
 *
 * The point of exporting is that the track outlives this app, so the output
 * targets plain GPX 1.1 that any mapping tool will read — no extensions, no
 * WorldTrace-specific fields.
 *
 * Note the direction: WorldTrace exports GPX but deliberately does not import
 * it. A file cannot testify that you were somewhere.
 */

export interface TrackPoint {
  lat: number;
  lon: number;
  /** Epoch milliseconds. */
  ts: number;
  altitude: number | null;
}

export interface TrackSegment {
  id: number;
  points: TrackPoint[];
}

export interface GpxOptions {
  name?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildGpx(segments: TrackSegment[], options: GpxOptions = {}): string {
  const { name = 'WorldTrace' } = options;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="WorldTrace" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <trk>',
    `    <name>${escapeXml(name)}</name>`,
  ];

  for (const segment of segments) {
    // An empty <trkseg> is legal but says nothing; skip it.
    if (segment.points.length === 0) continue;

    lines.push('    <trkseg>');
    for (const point of segment.points) {
      lines.push(`      <trkpt lat="${point.lat}" lon="${point.lon}">`);
      if (point.altitude !== null) {
        lines.push(`        <ele>${point.altitude}</ele>`);
      }
      lines.push(`        <time>${new Date(point.ts).toISOString()}</time>`);
      lines.push('      </trkpt>');
    }
    lines.push('    </trkseg>');
  }

  lines.push('  </trk>', '</gpx>', '');
  return lines.join('\n');
}
