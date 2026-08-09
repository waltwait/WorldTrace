import { describe, expect, test } from 'vitest';
import { DEFAULT_LIMITS, createGatekeeper, type Fix } from './gatekeeper';

const BASE_TIME = Date.UTC(2026, 7, 2, 9, 0, 0);
const ORIGIN = { lat: 25.033, lon: 121.5654 };

/** A clean fix: good accuracy, no mock flag, `seconds` after the base time. */
function fix(seconds: number, eastMeters = 0, overrides: Partial<Fix> = {}): Fix {
  return {
    lat: ORIGIN.lat,
    lon: ORIGIN.lon + eastMeters / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
    accuracy: 8,
    timestamp: BASE_TIME + seconds * 1000,
    mocked: false,
    ...overrides,
  };
}

const CLEAN_DEVICE = { mockAppEnabled: false };

describe('the first fix', () => {
  test('is accepted and opens a segment', () => {
    const gatekeeper = createGatekeeper();

    expect(gatekeeper.verify(fix(0), CLEAN_DEVICE)).toEqual({
      accepted: true,
      startsNewSegment: true,
    });
  });

  test('is still rejected if it is mocked', () => {
    const gatekeeper = createGatekeeper();

    expect(gatekeeper.verify(fix(0, 0, { mocked: true }), CLEAN_DEVICE)).toEqual({
      accepted: false,
      reason: 'MOCK_PROVIDER',
    });
  });
});

describe('MOCK_PROVIDER', () => {
  test('rejects a fix flagged by the platform as mocked', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(0), CLEAN_DEVICE);

    const verdict = gatekeeper.verify(fix(1, 1, { mocked: true }), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: false, reason: 'MOCK_PROVIDER' });
  });

  test('takes precedence over every other problem with the fix', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(0), CLEAN_DEVICE);

    // Mocked, wildly inaccurate, and a teleport all at once.
    const verdict = gatekeeper.verify(
      fix(1, 500_000, { mocked: true, accuracy: 900 }),
      CLEAN_DEVICE,
    );

    expect(verdict).toEqual({ accepted: false, reason: 'MOCK_PROVIDER' });
  });
});

describe('resume', () => {
  test('makes the next fix subject to the movement checks', () => {
    // Without this, a process restart between two fixes would let anything
    // through: with no previous fix there is nothing to measure against.
    const gatekeeper = createGatekeeper();
    gatekeeper.resume(fix(0));

    const verdict = gatekeeper.verify(fix(10, 100_000), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: false, reason: 'TELEPORT' });
  });

  test('keeps the following fix in the same segment', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.resume(fix(0));

    expect(gatekeeper.verify(fix(10, 15), CLEAN_DEVICE)).toEqual({
      accepted: true,
      startsNewSegment: false,
    });
  });

  test('still opens a new segment when the resumed fix is old', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.resume(fix(0));

    expect(gatekeeper.verify(fix(120 * 60, 300_000), CLEAN_DEVICE)).toEqual({
      accepted: true,
      startsNewSegment: true,
    });
  });

  test('rejects a fix that predates the resumed one', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.resume(fix(10));

    expect(gatekeeper.verify(fix(5, 1), CLEAN_DEVICE)).toEqual({
      accepted: false,
      reason: 'TIME_ANOMALY',
    });
  });

  test('does not claim any acceleration history it cannot know', () => {
    // The speed leading up to the resumed fix was lost with the process, so
    // the first fix after a resume cannot be judged on acceleration.
    const gatekeeper = createGatekeeper();
    gatekeeper.resume(fix(0));

    expect(gatekeeper.verify(fix(1, 100), CLEAN_DEVICE)).toMatchObject({ accepted: true });
  });
});

describe('allowMockedFixes', () => {
  test('is off by default, which is the whole premise of the app', () => {
    const gatekeeper = createGatekeeper();

    expect(gatekeeper.verify(fix(0, 0, { mocked: true }), CLEAN_DEVICE)).toEqual({
      accepted: false,
      reason: 'MOCK_PROVIDER',
    });
  });

  test('accepts mocked fixes when explicitly switched on for development', () => {
    const gatekeeper = createGatekeeper({ allowMockedFixes: true });

    expect(gatekeeper.verify(fix(0, 0, { mocked: true }), CLEAN_DEVICE)).toMatchObject({
      accepted: true,
    });
  });

  test('also stands down the stricter mock-app rule when switched on', () => {
    const gatekeeper = createGatekeeper({
      allowMockedFixes: true,
      refuseWhenMockAppEnabled: true,
    });

    expect(gatekeeper.verify(fix(0), { mockAppEnabled: true })).toMatchObject({
      accepted: true,
    });
  });

  test('still applies the physical checks to mocked fixes', () => {
    // A development bypass is not a licence to record nonsense: a mock GPS app
    // teleporting across the country must still be refused, or testing with it
    // proves nothing about the real rules.
    const gatekeeper = createGatekeeper({ allowMockedFixes: true });
    gatekeeper.verify(fix(0, 0, { mocked: true }), CLEAN_DEVICE);

    expect(gatekeeper.verify(fix(10, 100_000, { mocked: true }), CLEAN_DEVICE)).toEqual({
      accepted: false,
      reason: 'TELEPORT',
    });
  });
});

describe('MOCK_APP_ENABLED', () => {
  test('is ignored by default, because it is a device-wide setting', () => {
    // Having a mock location app selected says nothing about whether *this*
    // fix was faked. Plenty of people keep one configured for other apps, and
    // refusing on that basis would reject their real GPS forever.
    const gatekeeper = createGatekeeper();

    const verdict = gatekeeper.verify(fix(0), { mockAppEnabled: true });

    expect(verdict).toMatchObject({ accepted: true });
  });

  test('still refuses a fix that is itself mocked, even by default', () => {
    const gatekeeper = createGatekeeper();

    const verdict = gatekeeper.verify(fix(0, 0, { mocked: true }), {
      mockAppEnabled: true,
    });

    expect(verdict).toEqual({ accepted: false, reason: 'MOCK_PROVIDER' });
  });

  test('rejects every fix when the stricter rule is switched on', () => {
    const gatekeeper = createGatekeeper({ refuseWhenMockAppEnabled: true });

    const verdict = gatekeeper.verify(fix(0), { mockAppEnabled: true });

    expect(verdict).toEqual({ accepted: false, reason: 'MOCK_APP_ENABLED' });
  });

  test('resumes accepting fixes once the setting is removed', () => {
    const gatekeeper = createGatekeeper({ refuseWhenMockAppEnabled: true });
    gatekeeper.verify(fix(0), { mockAppEnabled: true });

    const verdict = gatekeeper.verify(fix(1, 1), CLEAN_DEVICE);

    expect(verdict).toMatchObject({ accepted: true });
  });
});

describe('LOW_ACCURACY', () => {
  test('rejects a fix less accurate than the limit', () => {
    const gatekeeper = createGatekeeper();

    const verdict = gatekeeper.verify(fix(0, 0, { accuracy: 150 }), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: false, reason: 'LOW_ACCURACY' });
  });

  test('accepts a fix exactly at the limit', () => {
    const gatekeeper = createGatekeeper();

    const verdict = gatekeeper.verify(
      fix(0, 0, { accuracy: DEFAULT_LIMITS.maxAccuracyMeters }),
      CLEAN_DEVICE,
    );

    expect(verdict).toMatchObject({ accepted: true });
  });

  test('rejects a fix with no accuracy at all', () => {
    const gatekeeper = createGatekeeper();

    const verdict = gatekeeper.verify(fix(0, 0, { accuracy: null }), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: false, reason: 'LOW_ACCURACY' });
  });
});

describe('TIME_ANOMALY', () => {
  test('rejects a fix older than the last accepted one', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(10), CLEAN_DEVICE);

    const verdict = gatekeeper.verify(fix(5, 1), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: false, reason: 'TIME_ANOMALY' });
  });

  test('rejects a fix with the same timestamp as the last accepted one', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(10), CLEAN_DEVICE);

    const verdict = gatekeeper.verify(fix(10, 1), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: false, reason: 'TIME_ANOMALY' });
  });
});

describe('TELEPORT', () => {
  test('rejects movement faster than any aircraft', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(0), CLEAN_DEVICE);

    // 100 km in 10 seconds.
    const verdict = gatekeeper.verify(fix(10, 100_000), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: false, reason: 'TELEPORT' });
  });

  test('accepts airliner speeds', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(0), CLEAN_DEVICE);

    // 250 m/s for a minute.
    const verdict = gatekeeper.verify(fix(60, 15_000), CLEAN_DEVICE);

    expect(verdict).toMatchObject({ accepted: true });
  });

  test('accepts movement exactly at the speed limit', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(0), CLEAN_DEVICE);

    const verdict = gatekeeper.verify(
      fix(10, DEFAULT_LIMITS.maxSpeedMetersPerSecond * 10),
      CLEAN_DEVICE,
    );

    expect(verdict).toMatchObject({ accepted: true });
  });

  test('compares against the last accepted fix, not the last rejected one', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(0), CLEAN_DEVICE);
    gatekeeper.verify(fix(10, 100_000), CLEAN_DEVICE); // rejected teleport

    // A normal step from the original position must still be fine.
    const verdict = gatekeeper.verify(fix(20, 20), CLEAN_DEVICE);

    expect(verdict).toMatchObject({ accepted: true });
  });
});

describe('long gaps in recording', () => {
  test('accepts a distant fix after a long gap instead of calling it a teleport', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(0), CLEAN_DEVICE);

    // Two hours later, on the other side of the country.
    const verdict = gatekeeper.verify(fix(120 * 60, 300_000), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: true, startsNewSegment: true });
  });

  test('keeps consecutive fixes inside the same segment', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(0), CLEAN_DEVICE);

    const verdict = gatekeeper.verify(fix(5, 7), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: true, startsNewSegment: false });
  });
});

describe('IMPOSSIBLE_ACCEL', () => {
  /** Walk two steps so the gatekeeper has a speed to compare against. */
  function walkTwoSteps(gatekeeper: ReturnType<typeof createGatekeeper>) {
    gatekeeper.verify(fix(0, 0), CLEAN_DEVICE);
    gatekeeper.verify(fix(1, 1.4), CLEAN_DEVICE);
    gatekeeper.verify(fix(2, 2.8), CLEAN_DEVICE);
  }

  test('tolerates a single acceleration spike, which is usually GPS noise', () => {
    const gatekeeper = createGatekeeper();
    walkTwoSteps(gatekeeper);

    const spike = gatekeeper.verify(fix(3, 42), CLEAN_DEVICE);
    const settled = gatekeeper.verify(fix(4, 43.4), CLEAN_DEVICE);

    expect(spike).toMatchObject({ accepted: true });
    expect(settled).toMatchObject({ accepted: true });
  });

  test('rejects acceleration sustained beyond the streak limit', () => {
    const gatekeeper = createGatekeeper();
    walkTwoSteps(gatekeeper);

    // Implied speed climbing by 20 m/s every second.
    const verdicts = [
      gatekeeper.verify(fix(3, 24.2), CLEAN_DEVICE), // v=21.4  streak 1
      gatekeeper.verify(fix(4, 65.6), CLEAN_DEVICE), // v=41.4  streak 2
      gatekeeper.verify(fix(5, 127.0), CLEAN_DEVICE), // v=61.4 streak 3
      gatekeeper.verify(fix(6, 208.4), CLEAN_DEVICE), // v=81.4 streak 4
    ];

    expect(verdicts.slice(0, 3).every((v) => v.accepted)).toBe(true);
    expect(verdicts[3]).toEqual({ accepted: false, reason: 'IMPOSSIBLE_ACCEL' });
  });

  test('does not flag steady high speed, which has no acceleration', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(0, 0), CLEAN_DEVICE);

    // A train at a constant 80 m/s.
    const verdicts = [1, 2, 3, 4, 5, 6].map((s) =>
      gatekeeper.verify(fix(s, 80 * s), CLEAN_DEVICE),
    );

    expect(verdicts.every((v) => v.accepted)).toBe(true);
  });
});

describe('rule precedence', () => {
  test('reports low accuracy before looking at movement', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(0), CLEAN_DEVICE);

    const verdict = gatekeeper.verify(
      fix(1, 100_000, { accuracy: 500 }),
      CLEAN_DEVICE,
    );

    expect(verdict).toEqual({ accepted: false, reason: 'LOW_ACCURACY' });
  });

  test('reports a time anomaly before a teleport', () => {
    const gatekeeper = createGatekeeper();
    gatekeeper.verify(fix(10), CLEAN_DEVICE);

    const verdict = gatekeeper.verify(fix(5, 100_000), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: false, reason: 'TIME_ANOMALY' });
  });
});
