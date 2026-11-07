/**
 * Finds styles that name a font file and ask for a weight as well.
 *
 * Each weight of Sora is its own file and its own family. A `fontWeight` beside
 * one has nothing left to choose, and Android may thicken the letters on top of
 * a face that is already bold. No component can be mounted under vitest, so this
 * reads the source, as hookOrder does.
 */

export interface DoubledWeight {
  file: string;
  line: number;
}

export function findDoubledWeights(file: string, source: string): DoubledWeight[] {
  const found: DoubledWeight[] = [];

  for (const match of source.matchAll(/fontFamily:\s*FONT\.\w+/g)) {
    const start = source.lastIndexOf('{', match.index);
    const end = source.indexOf('}', match.index);
    if (/\bfontWeight\s*:/.test(source.slice(start, end))) {
      found.push({ file, line: source.slice(0, match.index).split('\n').length });
    }
  }

  return found;
}
