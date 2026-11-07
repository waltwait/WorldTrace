/**
 * Which font file a piece of text is drawn in.
 *
 * React Native has no default font, so without this every line takes whatever the
 * phone is set to, which on this one is a handwriting face. Nor does a weight pick
 * a file on Android: each weight here is a family of its own. And a style in Sora
 * has no Chinese to draw, so its Chinese falls through to the phone's font as well,
 * the 「天」 of 「116 天」, unless it is set apart. `Text.tsx` applies all of this.
 */

import { FONT, NOTO } from './themes';

function notoFor(weight: unknown): string {
  const value = weight === 'bold' ? 700 : Number(weight);
  if (value >= 900) return NOTO.black;
  if (value >= 600) return NOTO.bold;
  return NOTO.regular;
}

export function resolveFont<T extends { fontFamily?: string; fontWeight?: unknown }>(
  style: T,
): Omit<T, 'fontWeight'> & { fontFamily: string; includeFontPadding: false } {
  const { fontWeight, ...rest } = style;
  return {
    ...rest,
    fontFamily: style.fontFamily ?? notoFor(fontWeight),
    includeFontPadding: false,
  };
}

/** The Noto to draw Chinese in beside this font, if it has no Chinese of its own. */
export function notoBeside(family: string): string | null {
  if (family === FONT.bold) return NOTO.bold;
  if (family === FONT.extraBold) return NOTO.black;
  return null;
}

// Arrows, CJK, and full-width forms: everything these screens print that Sora lacks.
const NOT_IN_SORA = /[←-⇿⺀-鿿豈-﫿︰-﹏＀-￯]+/g;

export function scriptRuns(text: string): Array<{ text: string; chinese: boolean }> {
  const runs: Array<{ text: string; chinese: boolean }> = [];
  let from = 0;

  for (const match of text.matchAll(NOT_IN_SORA)) {
    if (match.index > from) runs.push({ text: text.slice(from, match.index), chinese: false });
    runs.push({ text: match[0], chinese: true });
    from = match.index + match[0].length;
  }

  if (from < text.length) runs.push({ text: text.slice(from), chinese: false });
  return runs;
}
