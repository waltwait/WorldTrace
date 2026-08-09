/**
 * When an automatic backup is worth doing.
 *
 * Pure, and separate from everything that touches the network, because the
 * failure modes here are all about time: a device whose clock jumped, a walk
 * that produces a fix every few seconds, a database that has not changed since
 * the last upload. Those are cheap to test and expensive to get wrong.
 */

export interface BackupLimits {
  /** Never back up more often than this, however much new track arrives. */
  minimumIntervalMs: number;
}

export const DEFAULT_BACKUP_LIMITS: BackupLimits = {
  // Six hours. Frequent enough that losing a phone costs at most part of a
  // day's walking; rare enough that a whole day out is a handful of uploads.
  minimumIntervalMs: 6 * 60 * 60 * 1000,
};

export type BackupReason = 'never-backed-up' | 'new-track' | 'nothing-new' | 'too-soon' | 'no-data';

export interface BackupDecision {
  backUp: boolean;
  reason: BackupReason;
}

export interface BackupState {
  now: number;
  /** When the database was last uploaded, or null if it never has been. */
  lastBackupAt: number | null;
  /** The most recent fix in the database, or null if there is no track. */
  lastRecordedAt: number | null;
}

export function shouldBackUp(
  state: BackupState,
  limits: Partial<BackupLimits> = {},
): BackupDecision {
  const { minimumIntervalMs } = { ...DEFAULT_BACKUP_LIMITS, ...limits };

  if (state.lastRecordedAt === null) return { backUp: false, reason: 'no-data' };
  if (state.lastBackupAt === null) return { backUp: true, reason: 'never-backed-up' };

  // A backup stamped in the future means the clock moved. Every comparison
  // below it is then meaningless — both "nothing new" and "too soon" would say
  // no, forever — so it is treated as due right now and the stamp gets
  // rewritten with a sane value.
  const elapsed = state.now - state.lastBackupAt;
  if (elapsed < 0) return { backUp: true, reason: 'new-track' };

  if (state.lastRecordedAt <= state.lastBackupAt) {
    return { backUp: false, reason: 'nothing-new' };
  }

  if (elapsed <= minimumIntervalMs) {
    return { backUp: false, reason: 'too-soon' };
  }

  return { backUp: true, reason: 'new-track' };
}
