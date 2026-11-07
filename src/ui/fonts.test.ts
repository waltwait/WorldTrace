import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { notoBeside, resolveFont, scriptRuns } from './fonts';
import { FONT, NOTO } from './themes';

describe('resolveFont', () => {
  test.each([
    [undefined, NOTO.regular],
    ['400', NOTO.regular],
    ['500', NOTO.regular],
    ['600', NOTO.bold],
    ['700', NOTO.bold],
    ['800', NOTO.bold],
    ['900', NOTO.black],
    ['bold', NOTO.bold],
    [700, NOTO.bold],
  ])('reads a weight of %s as its file', (fontWeight, family) => {
    expect(resolveFont({ fontWeight }).fontFamily).toBe(family);
  });

  // Each weight is its own file. Left in, Android may thicken a face already bold.
  test('takes the weight out once it has chosen the file', () => {
    expect(resolveFont({ fontWeight: '700' })).not.toHaveProperty('fontWeight');
  });

  test('leaves a font named by the style alone', () => {
    expect(resolveFont({ fontFamily: FONT.bold }).fontFamily).toBe(FONT.bold);
  });

  test('keeps the rest of the style', () => {
    expect(resolveFont({ fontWeight: '400', fontSize: 20, color: '#000' })).toMatchObject({
      fontSize: 20,
      color: '#000',
    });
  });

  // Noto's line box is tall, and the padding Android adds on top of it pushes text
  // off the centre of everything it sits in.
  test('drops the padding Android adds around a font', () => {
    expect(resolveFont({}).includeFontPadding).toBe(false);
  });
});

describe('notoBeside', () => {
  test('matches each Sora to the Chinese that sits beside it', () => {
    expect(notoBeside(FONT.bold)).toBe(NOTO.bold);
    expect(notoBeside(FONT.extraBold)).toBe(NOTO.black);
  });

  test('has nothing to add to Noto itself', () => {
    expect(notoBeside(NOTO.bold)).toBeNull();
  });
});

describe('scriptRuns', () => {
  test('leaves text with no Chinese in one piece', () => {
    expect(scriptRuns('3,221.62 km')).toEqual([{ text: '3,221.62 km', chinese: false }]);
  });

  test('splits figures from Chinese', () => {
    expect(scriptRuns('116 天')).toEqual([
      { text: '116 ', chinese: false },
      { text: '天', chinese: true },
    ]);
  });

  test('takes all-Chinese text whole', () => {
    expect(scriptRuns('已取消')).toEqual([{ text: '已取消', chinese: true }]);
  });

  // Sora has no arrows either, and the phone's own font would draw that one.
  test('counts the arrow with what Sora cannot draw', () => {
    expect(scriptRuns(' → ')).toEqual([
      { text: ' ', chinese: false },
      { text: '→', chinese: true },
      { text: ' ', chinese: false },
    ]);
  });

  test('counts full-width punctuation too', () => {
    expect(scriptRuns('A，B').map((run) => run.chinese)).toEqual([false, true, false]);
  });

  test('gives nothing for nothing', () => {
    expect(scriptRuns('')).toEqual([]);
  });
});

// Nothing has a default font in React Native, so a screen that reaches for the
// plain Text draws in whatever the phone is set to. No component can be mounted
// under vitest, so this reads the source, as hookOrder does.
describe('the screens', () => {
  const dir = __dirname;
  const screens = readdirSync(dir)
    .filter((name) => name.endsWith('.tsx') && name !== 'Text.tsx')
    .map((name) => ({ name, source: readFileSync(join(dir, name), 'utf8') }));

  test('take their Text from ./Text', () => {
    const offenders = screens.filter(({ source }) =>
      [...source.matchAll(/import\s*\{([^}]*)\}\s*from 'react-native'/g)].some(([, names]) =>
        /\b(Text|TextInput)\b/.test(names.replace(/\btype\s+\w+/g, '')),
      ),
    );

    expect(offenders.map(({ name }) => name)).toEqual([]);
  });

  test('resolve the font of animated text by hand', () => {
    const offenders = screens.filter(({ source }) =>
      [...source.matchAll(/<Animated\.Text[^>]*?style=\{([^}]*)/gs)].some(
        ([, style]) => !style.includes('textStyle('),
      ),
    );

    expect(offenders.map(({ name }) => name)).toEqual([]);
  });
});
