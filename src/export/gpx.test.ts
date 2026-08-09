import { describe, expect, test } from 'vitest';
import { buildGpx, type TrackSegment } from './gpx';

const T0 = Date.UTC(2026, 7, 2, 9, 0, 0);

function segment(id: number, count: number): TrackSegment {
  return {
    id,
    points: Array.from({ length: count }, (_, i) => ({
      lat: 25.033 + i * 0.0001,
      lon: 121.5654 + i * 0.0001,
      ts: T0 + i * 1000,
      altitude: 12.5,
    })),
  };
}

describe('buildGpx', () => {
  test('produces a well-formed GPX 1.1 document', () => {
    const gpx = buildGpx([segment(1, 2)]);

    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx.trimEnd().endsWith('</gpx>')).toBe(true);
  });

  test('is still valid when there is nothing to export', () => {
    const gpx = buildGpx([]);

    expect(gpx).toContain('</gpx>');
    expect(gpx).not.toContain('<trkseg>');
  });

  test('writes one track segment per recorded segment', () => {
    const gpx = buildGpx([segment(1, 2), segment(2, 3)]);

    expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
    expect(gpx.match(/<trkpt /g)).toHaveLength(5);
  });

  test('keeps points in the order they were recorded', () => {
    const gpx = buildGpx([segment(1, 3)]);
    const times = [...gpx.matchAll(/<time>([^<]+)<\/time>/g)].map((m) => m[1]);

    expect(times).toEqual([
      '2026-08-02T09:00:00.000Z',
      '2026-08-02T09:00:01.000Z',
      '2026-08-02T09:00:02.000Z',
    ]);
  });

  test('writes coordinates as GPX attributes', () => {
    const gpx = buildGpx([
      { id: 1, points: [{ lat: 25.033, lon: 121.5654, ts: T0, altitude: null }] },
    ]);

    expect(gpx).toContain('<trkpt lat="25.033" lon="121.5654">');
  });

  test('includes elevation when the fix had one', () => {
    const gpx = buildGpx([segment(1, 1)]);

    expect(gpx).toContain('<ele>12.5</ele>');
  });

  test('omits elevation rather than inventing a zero', () => {
    const gpx = buildGpx([
      { id: 1, points: [{ lat: 1, lon: 2, ts: T0, altitude: null }] },
    ]);

    expect(gpx).not.toContain('<ele>');
  });

  test('escapes the track name so a stray character cannot break the file', () => {
    const gpx = buildGpx([segment(1, 1)], { name: 'me & "you" <here>' });

    expect(gpx).toContain('me &amp; &quot;you&quot; &lt;here&gt;');
    expect(gpx).not.toContain('<here>');
  });

  test('drops empty segments, which would be meaningless in the file', () => {
    const gpx = buildGpx([{ id: 1, points: [] }, segment(2, 2)]);

    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
  });
});
