import { describe, expect, test } from 'vitest';
import { countryName, flagEmoji } from './countries';

describe('countryName', () => {
  test('is in Traditional Chinese', () => {
    expect(countryName('TW')).toBe('台灣');
    expect(countryName('JP')).toBe('日本');
    expect(countryName('US')).toBe('美國');
  });

  test('is the short form', () => {
    expect(countryName('HK')).toBe('香港');
    expect(countryName('MO')).toBe('澳門');
  });

  test('falls back to the code it was given', () => {
    expect(countryName('ZZ')).toBe('ZZ');
  });

  test('takes a code in small letters', () => {
    expect(countryName('jp')).toBe('日本');
  });
});

describe('flagEmoji', () => {
  test('is built from the two letters of the code', () => {
    expect(flagEmoji('TW')).toBe('🇹🇼');
    expect(flagEmoji('jp')).toBe('🇯🇵');
  });

  test('has nothing to show for something that is not a code', () => {
    expect(flagEmoji('')).toBe('');
    expect(flagEmoji('TWN')).toBe('');
    expect(flagEmoji(null)).toBe('');
  });
});
