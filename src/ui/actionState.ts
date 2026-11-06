/**
 * What one button should be showing while the thing it was tapped for happens.
 *
 * A button used to answer a tap by swapping its label for "處理中…" and, when
 * the work finished, leaving a line of text at the bottom of the screen — far
 * from the thing that was touched, and gone only when something else replaced
 * it. This keeps the answer on the button instead: idle, then busy, then a
 * short confirmation, then idle again.
 *
 * Timing is what makes it feel right, so timing is what is tested:
 *
 * - Busy is not shown at once. Most of these finish in a blink, and a spinner
 *   that is there for 30 ms reads as a glitch, not as progress.
 * - Once busy has been shown it stays for a minimum time, for the same reason
 *   in the other direction.
 * - A confirmation is held long enough to read and then gives way on its own.
 *
 * Plain code with no React in it, because a hook is where logic like this goes
 * to escape its tests. The view subscribes through useSyncExternalStore, which
 * is why `phase()` hands back the same object until something changes.
 */

export type ActionPhase =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; message: string };

/** How long an action runs before busy is shown at all. */
export const BUSY_AFTER_MS = 120;
/** How long busy stays up once it has been shown. */
export const MIN_BUSY_MS = 400;
/** How long a confirmation is held before the button goes back to normal. */
export const DONE_HOLD_MS = 2200;

const IDLE: ActionPhase = { kind: 'idle' };
const BUSY: ActionPhase = { kind: 'busy' };

export interface ActionState {
  /** What to show now. The same object until it changes. */
  phase(): ActionPhase;
  subscribe(listener: () => void): () => void;
  /** The button was tapped and the work has started. */
  begin(): void;
  /** The work finished. A null message means there is nothing to confirm. */
  succeed(message: string | null): void;
  /** The work failed. Saying so is somebody else's job (a dialog), not the button's. */
  fail(): void;
  /** Stop all timers and listeners: the button has gone. */
  dispose(): void;
}

export function createActionState(): ActionState {
  let phase: ActionPhase = IDLE;
  let pending = false;
  let busyShownAt = 0;

  // Every pending timer, so that starting again or finishing can cancel the ones
  // that belong to what came before: an old confirmation's hold running out must
  // not cut a new action's busy state short.
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  const listeners = new Set<() => void>();

  const show = (next: ActionPhase) => {
    if (next === phase) return;
    phase = next;
    for (const listener of [...listeners]) listener();
  };

  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };

  const later = (ms: number, then: () => void) => {
    const timer = setTimeout(() => {
      timers = timers.filter((t) => t !== timer);
      then();
    }, ms);
    timers.push(timer);
  };

  return {
    phase: () => phase,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    begin() {
      clear();
      pending = true;
      show(IDLE);

      later(BUSY_AFTER_MS, () => {
        busyShownAt = Date.now();
        show(BUSY);
      });
    },

    succeed(message) {
      if (!pending) return;
      pending = false;

      const wasBusy = phase === BUSY;
      clear();

      const settle = () => {
        if (message === null) {
          show(IDLE);
          return;
        }

        show({ kind: 'done', message });
        later(DONE_HOLD_MS, () => show(IDLE));
      };

      const owed = wasBusy ? busyShownAt + MIN_BUSY_MS - Date.now() : 0;
      if (owed > 0) later(owed, settle);
      else settle();
    },

    fail() {
      if (!pending) return;
      pending = false;

      clear();
      show(IDLE);
    },

    dispose() {
      clear();
      listeners.clear();
      pending = false;
    },
  };
}

/** What a button's work says when it is done. */
export type ActionResult = { ok: true; message: string | null } | { ok: false };

/**
 * Drive one tap of a button: ask first if there is something to ask, then show
 * busy while the work runs and settle on however it ended.
 *
 * Asking comes before beginning because the question is not work: a button that
 * spins behind a confirmation dialog is telling the user something is already
 * happening that has not been agreed to yet.
 *
 * Whatever the work does, the button is not left spinning: an error settles it
 * and is then passed on, since what to say about it is the caller's business.
 */
export async function runAction(
  state: ActionState,
  work: () => Promise<ActionResult>,
  confirm?: () => Promise<boolean>,
): Promise<void> {
  if (confirm && !(await confirm())) return;

  state.begin();

  try {
    const result = await work();
    if (result.ok) state.succeed(result.message);
    else state.fail();
  } catch (error) {
    state.fail();
    throw error;
  }
}

/**
 * What text the button should show for its current phase.
 *
 * When a `busyLabel` is given (e.g. "備份中…"), entering the busy phase swaps
 * the text itself so the eye sees the button answer even before the work ends.
 */
export function buttonLabel(
  phase: ActionPhase,
  options: { label: string; busyLabel?: string; tickInText?: boolean },
): string {
  if (phase.kind === 'idle') return options.label;
  if (phase.kind === 'busy') return options.busyLabel ?? options.label;
  return options.tickInText ? `✓ ${phase.message}` : phase.message;
}
