import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readFont } from './testing/fontFile';
import { findDoubledWeights } from './testing/fontStyles';
import {
  FONT,
  NOTO,
  DEFAULT_THEME,
  parseThemeId,
  serializeThemeId,
  THEMES,
  THEME_IDS,
} from './themes';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

describe('the themes', () => {
  test('default to 灰藍', () => {
    expect(DEFAULT_THEME).toBe('blue');
    expect(THEMES.blue.name).toBe('灰藍');
  });

  test('are the four on the canvas', () => {
    expect(THEME_IDS.map((id) => THEMES[id].name)).toEqual(['灰藍', '灰紫', '石墨', '鮮紫']);
  });

  // A theme nobody can read in is not a theme.
  describe.each(THEME_IDS)('%s stays readable', (id) => {
    const t = THEMES[id];

    test.each([
      ['ink on the ground', t.ink, t.ground],
      ['ink on a soft tile', t.ink, t.soft],
      ['muted text on the ground', t.muted, t.ground],
      ['muted text on a soft tile', t.muted, t.soft],
      ['white on a tile', '#FFFFFF', t.tile],
      ['secondary text on a tile', t.onTile, t.tile],
      ['ink on the accent', t.ink, t.accent],
    ])('%s', (_name, fg, bg) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe('the saved choice', () => {
  test('reads back what was saved', () => {
    for (const id of THEME_IDS) expect(parseThemeId(serializeThemeId(id))).toBe(id);
  });

  test.each([
    ['nothing', null],
    ['garbage', 'not json'],
    ['a theme that no longer exists', '{"theme":"neon"}'],
    ['the wrong shape', '[1,2]'],
  ])('falls back to the default on %s', (_name, text) => {
    expect(parseThemeId(text)).toBe(DEFAULT_THEME);
  });
});

describe('the fonts', () => {
  const root = join(__dirname, '..', '..');
  const names = [...Object.values(FONT), ...Object.values(NOTO)];

  test('each has its file, or Android quietly draws the system font instead', () => {
    for (const name of names) {
      expect(existsSync(join(root, 'assets', 'fonts', `${name}.ttf`))).toBe(true);
    }
  });

  // android/ is hand-edited and gitignored: this is what a prebuild rebuilds it from.
  test('each is listed in app.json, so a prebuild puts it back', () => {
    const { expo } = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
    const plugin = expo.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-font');

    expect(plugin?.[1].fonts).toEqual(names.map((name) => `./assets/fonts/${name}.ttf`));
  });

  // Both of these are edits to the font file, made by tools/fonts/. Replacing a file
  // undoes them without a word, which is what these are for.
  describe.each(Object.values(NOTO))('%s', (name) => {
    const font = readFont(readFileSync(join(root, 'assets', 'fonts', `${name}.ttf`)));

    // As shipped, Chinese sits low in its line, 0.5 to 1 dp in every button and pill.
    test('has Chinese in the middle of its line', () => {
      const line = (font.lineAscent + font.lineDescent) / 2;
      const face = (font.faceAscent + font.faceDescent) / 2;

      expect(Math.abs(line - face)).toBeLessThanOrEqual(1);
    });

    test('keeps the height of a line', () => {
      expect(font.lineAscent - font.lineDescent).toBe(1448);
    });

    // A font's own black-and-white 🆕 would win over the phone's colour one.
    test.each([
      ['🆕', 0x1f195],
      ['🈚', 0x1f21a],
      ['⚽', 0x26bd],
    ])('leaves %s to the phone', (_emoji, codePoint) => {
      expect(font.hasCharacter(codePoint)).toBe(false);
    });

    test('still has its Chinese', () => {
      expect(font.hasCharacter(0x822a)).toBe(true);
    });
  });

  describe('a style', () => {
    test('that names a font and a weight is found', () => {
      const source = `{\n  fontFamily: FONT.bold,\n  fontSize: 20,\n  fontWeight: '700',\n}`;

      expect(findDoubledWeights('x.tsx', source)).toEqual([{ file: 'x.tsx', line: 2 }]);
    });

    test('that names a font alone is fine', () => {
      expect(findDoubledWeights('x.tsx', `{ fontFamily: FONT.bold, fontSize: 20 }`)).toEqual([]);
    });

    test('next to one with a weight is fine', () => {
      const source = `a: { fontWeight: '700' },\n b: { fontFamily: FONT.bold }`;

      expect(findDoubledWeights('x.tsx', source)).toEqual([]);
    });

    test('nowhere in the app does both', () => {
      const dir = join(root, 'src', 'ui');
      const files = readdirSync(dir).filter((name) => name.endsWith('.tsx'));

      expect(
        files.flatMap((name) => findDoubledWeights(name, readFileSync(join(dir, name), 'utf8'))),
      ).toEqual([]);
    });
  });
});
