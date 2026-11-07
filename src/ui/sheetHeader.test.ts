import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// The way out of a page stays on the screen however far it is scrolled. No component
// can be mounted under vitest, so this reads the source, as hookOrder does.
describe.each(['FlightDetailSheet', 'AddFlightSheet', 'ExploreScreen', 'PassportScreen', 'TripScreen', 'TimelineScreen'])(
  '%s',
  (name) => {
    const source = readFileSync(join(__dirname, `${name}.tsx`), 'utf8');
    const page = source.slice(source.indexOf('<FullScreenModal'));

    test('has its header outside what scrolls', () => {
      const header = page.indexOf('<SheetHeader');

      expect(header).toBeGreaterThan(-1);
      expect(header).toBeLessThan(page.search(/<(ScrollView|SectionList|FlatList)\b/));
    });

    test('has no way out of its own inside it', () => {
      expect(page).not.toMatch(/label="(返回|關閉)"/);
    });
  },
);

describe('ShareCardSheet', () => {
  const source = readFileSync(join(__dirname, 'ShareCardSheet.tsx'), 'utf8');
  const page = source.slice(source.indexOf('<FullScreenModal'));

  test('uses SheetHeader inside FullScreenModal with no duplicate exit button', () => {
    expect(page.indexOf('<SheetHeader')).toBeGreaterThan(-1);
    expect(page).not.toMatch(/label="(返回|關閉)"/);
  });
});
