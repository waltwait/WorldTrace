import { describe, expect, test } from 'vitest';
import { DEFAULT_BACKUP_LIMITS, shouldBackUp } from './schedule';

const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function state(overrides: Partial<Parameters<typeof shouldBackUp>[0]> = {}) {
  return {
    now: NOW,
    lastBackupAt: null as number | null,
    lastRecordedAt: NOW - HOUR,
    ...overrides,
  };
}

describe('shouldBackUp', () => {
  test('backs up the first time there is anything to back up', () => {
    expect(shouldBackUp(state())).toEqual({ backUp: true, reason: 'never-backed-up' });
  });

  test('does nothing at all before any track exists', () => {
    // An empty database is not worth a round trip, and uploading one over a
    // good backup would be the worst possible outcome.
    expect(shouldBackUp(state({ lastRecordedAt: null }))).toEqual({
      backUp: false,
      reason: 'no-data',
    });
  });

  test('backs up once new track has arrived and the interval has passed', () => {
    const decision = shouldBackUp(
      state({ lastBackupAt: NOW - 24 * HOUR, lastRecordedAt: NOW - HOUR }),
    );

    expect(decision).toEqual({ backUp: true, reason: 'new-track' });
  });

  test('does not upload the same database twice', () => {
    const decision = shouldBackUp(
      state({ lastBackupAt: NOW - HOUR, lastRecordedAt: NOW - 24 * HOUR }),
    );

    expect(decision).toEqual({ backUp: false, reason: 'nothing-new' });
  });

  test('holds off when the last backup was recent, even with new track', () => {
    // Points arrive every few seconds while walking. Without this the app
    // would upload the whole database continuously on mobile data.
    const decision = shouldBackUp(state({ lastBackupAt: NOW - HOUR, lastRecordedAt: NOW }));

    expect(decision).toEqual({ backUp: false, reason: 'too-soon' });
  });

  test('backs up again once the interval is up', () => {
    const justOver = NOW - DEFAULT_BACKUP_LIMITS.minimumIntervalMs - 1;

    expect(shouldBackUp(state({ lastBackupAt: justOver, lastRecordedAt: NOW })).backUp).toBe(true);
  });

  test('treats the interval boundary as not yet due', () => {
    const exactly = NOW - DEFAULT_BACKUP_LIMITS.minimumIntervalMs;

    expect(shouldBackUp(state({ lastBackupAt: exactly, lastRecordedAt: NOW })).backUp).toBe(false);
  });

  test('checks for new track before it checks the clock', () => {
    // Both would block; "nothing-new" is the honest reason to show.
    const decision = shouldBackUp(
      state({ lastBackupAt: NOW - HOUR, lastRecordedAt: NOW - 48 * HOUR }),
    );

    expect(decision.reason).toBe('nothing-new');
  });

  test('backs up despite a clock that jumped backwards', () => {
    // A device whose clock moved back would otherwise never back up again:
    // every future backup would look like it happened in the future.
    const decision = shouldBackUp(state({ lastBackupAt: NOW + 100 * HOUR, lastRecordedAt: NOW }));

    expect(decision.backUp).toBe(true);
  });

  test('takes a caller-supplied interval', () => {
    const decision = shouldBackUp(state({ lastBackupAt: NOW - 2 * HOUR, lastRecordedAt: NOW }), {
      minimumIntervalMs: HOUR,
    });

    expect(decision.backUp).toBe(true);
  });
});
