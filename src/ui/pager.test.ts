import { describe, expect, test } from 'vitest';
import { pageAt, pagesBeside } from './pager';

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
