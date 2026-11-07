import { describe, expect, test } from 'vitest';
import { pageAt, pagerStops, pagesBeside, tabMotion } from './pager';

describe('pageAt', () => {
  const WIDTH = 360;

  test('is the page filling the screen', () => {
    expect(pageAt(0, WIDTH, 4)).toBe(0);
    expect(pageAt(720, WIDTH, 4)).toBe(2);
  });

  test('turns over at the halfway point', () => {
    expect(pageAt(179, WIDTH, 4)).toBe(0);
    expect(pageAt(180, WIDTH, 4)).toBe(1);
  });

  // Android reports past the ends while a fling settles.
  test('stays within the pages', () => {
    expect(pageAt(-40, WIDTH, 4)).toBe(0);
    expect(pageAt(1500, WIDTH, 4)).toBe(3);
  });

  test('is the first page before anything has a width', () => {
    expect(pageAt(0, 0, 4)).toBe(0);
  });
});

describe('pagesBeside', () => {
  test('is the page either side', () => {
    expect(pagesBeside(1, 4)).toEqual([0, 2]);
  });

  test('stops at the ends', () => {
    expect(pagesBeside(0, 4)).toEqual([1]);
    expect(pagesBeside(3, 4)).toEqual([2]);
  });
});

describe('pagerStops', () => {
  test('maps each page scroll offset to its toolbar slot', () => {
    expect(pagerStops(360, 4, 60)).toEqual({
      inputRange: [0, 360, 720, 1080],
      outputRange: [0, 60, 120, 180],
    });
  });

  // Animated.interpolate throws if inputRange has duplicate zeros before layout.
  test('gives nothing before the screen has a width or with fewer than two pages', () => {
    expect(pagerStops(0, 4, 60)).toBeNull();
    expect(pagerStops(-10, 4, 60)).toBeNull();
    expect(pagerStops(360, 1, 60)).toBeNull();
  });
});

describe('tabMotion', () => {
  // A page's name is largest while its page is showing, and shrinks as it slides away.
  test('is full size on its own page and small one page either side', () => {
    const motion = tabMotion(1, 300, 0.75);

    expect(motion.inputRange).toEqual([0, 300, 600]);
    expect(motion.scale).toEqual([0.75, 1, 0.75]);
  });

  test('fades from the quiet name to the strong one', () => {
    const motion = tabMotion(0, 300, 0.75);

    expect(motion.strong).toEqual([0, 1, 0]);
    expect(motion.quiet).toEqual([1, 0, 1]);
  });

  // Names after a small one move left by what it gave up, so the gaps stay even.
  test('says how much room it gives up', () => {
    expect(tabMotion(2, 300, 0.75).shrink).toEqual([0.25, 0, 0.25]);
  });
});
