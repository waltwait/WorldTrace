import { describe, expect, test } from 'vitest';
import { toFix, type PlatformLocation } from './toFix';

function location(overrides: Partial<PlatformLocation> = {}): PlatformLocation {
  return {
    coords: {
      latitude: 25.033,
      longitude: 121.5654,
      accuracy: 8,
      altitude: 12,
      speed: 1.4,
      heading: 90,
    },
    timestamp: Date.UTC(2026, 7, 2, 9, 0, 0),
    ...overrides,
  };
}

describe('toFix', () => {
  test('carries the coordinate across', () => {
    const fix = toFix(location());

    expect(fix.lat).toBe(25.033);
    expect(fix.lon).toBe(121.5654);
    expect(fix.accuracy).toBe(8);
    expect(fix.timestamp).toBe(Date.UTC(2026, 7, 2, 9, 0, 0));
  });

  test('carries the platform mock flag across', () => {
    expect(toFix(location({ mocked: true })).mocked).toBe(true);
  });

  test('treats a missing mock flag as not mocked, since only Android reports it', () => {
    expect(toFix(location()).mocked).toBe(false);
  });

  test('keeps a null accuracy null rather than inventing a number', () => {
    // The gatekeeper refuses fixes with no accuracy. Defaulting to 0 here
    // would turn the vaguest possible fix into the most precise one.
    const fix = toFix(location({ coords: { ...location().coords, accuracy: null } }));

    expect(fix.accuracy).toBeNull();
  });

  test('carries optional motion fields across', () => {
    const fix = toFix(location());

    expect(fix.altitude).toBe(12);
    expect(fix.speed).toBe(1.4);
    expect(fix.heading).toBe(90);
  });

  test('tolerates a platform that omits motion fields', () => {
    const fix = toFix(
      location({
        coords: { latitude: 1, longitude: 2, accuracy: 5 },
      }),
    );

    expect(fix.altitude).toBeNull();
    expect(fix.speed).toBeNull();
    expect(fix.heading).toBeNull();
  });
});
