import { describe, expect, test } from 'vitest';
import { parseHomeCountry, serializeHomeCountry } from './homeCountry';

describe('the home country file', () => {
  test('comes back as it went in', () => {
    expect(parseHomeCountry(serializeHomeCountry('TW'))).toBe('TW');
  });

  test('can say there is none', () => {
    expect(parseHomeCountry(serializeHomeCountry(null))).toBeNull();
  });

  test.each(['', 'not json', '{"code":"taiwan"}', '{"code":7}', '[]'])(
    'is no country at all when it reads %j',
    (text) => {
      expect(parseHomeCountry(text)).toBeNull();
    },
  );
});
