/** The few facts about a font file that the tests hold it to, read from its tables. */

export interface FontFacts {
  lineAscent: number;
  lineDescent: number;
  faceAscent: number;
  faceDescent: number;
  hasCharacter(codePoint: number): boolean;
}

export function readFont(bytes: Buffer): FontFacts {
  const tables = new Map<string, number>();
  const count = bytes.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const entry = 12 + 16 * i;
    tables.set(bytes.toString('latin1', entry, entry + 4), bytes.readUInt32BE(entry + 8));
  }

  const hhea = tables.get('hhea')!;
  const os2 = tables.get('OS/2')!;
  const cmap = tables.get('cmap')!;

  const subtables = Array.from({ length: bytes.readUInt16BE(cmap + 2) }, (_, i) =>
    cmap + bytes.readUInt32BE(cmap + 4 + 8 * i + 4),
  );

  return {
    lineAscent: bytes.readInt16BE(hhea + 4),
    lineDescent: bytes.readInt16BE(hhea + 6),
    faceAscent: bytes.readInt16BE(os2 + 68),
    faceDescent: bytes.readInt16BE(os2 + 70),
    hasCharacter: (codePoint) => subtables.some((at) => mapsCharacter(bytes, at, codePoint)),
  };
}

function mapsCharacter(bytes: Buffer, at: number, codePoint: number): boolean {
  const format = bytes.readUInt16BE(at);

  if (format === 12) {
    const groups = bytes.readUInt32BE(at + 12);
    for (let i = 0; i < groups; i++) {
      const group = at + 16 + 12 * i;
      if (codePoint >= bytes.readUInt32BE(group) && codePoint <= bytes.readUInt32BE(group + 4)) {
        return true;
      }
    }
    return false;
  }

  if (format === 4 && codePoint <= 0xffff) {
    const segments = bytes.readUInt16BE(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + 2 * segments + 2;
    const deltas = starts + 2 * segments;
    const offsets = deltas + 2 * segments;

    for (let i = 0; i < segments; i++) {
      if (codePoint > bytes.readUInt16BE(ends + 2 * i)) continue;
      const start = bytes.readUInt16BE(starts + 2 * i);
      if (codePoint < start) return false;

      const offset = bytes.readUInt16BE(offsets + 2 * i);
      if (offset === 0) return true;
      return bytes.readUInt16BE(offsets + 2 * i + offset + 2 * (codePoint - start)) !== 0;
    }
  }

  return false;
}
