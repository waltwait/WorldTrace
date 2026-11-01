import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  BUSY_AFTER_MS,
  createActionState,
  DONE_HOLD_MS,
  MIN_BUSY_MS,
  runAction,
  type ActionPhase,
  type ActionResult,
} from './actionState';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) => vi.advanceTimersByTime(ms);
const kind = (state: { phase(): ActionPhase }) => state.phase().kind;

describe('createActionState', () => {
  test('starts idle', () => {
    expect(kind(createActionState())).toBe('idle');
  });

  describe('an action that finishes quickly', () => {
    test('never shows the busy state, which would only flash', () => {
      const state = createActionState();
      const seen: string[] = [];
      state.subscribe(() => seen.push(kind(state)));

      state.begin();
      advance(BUSY_AFTER_MS - 1);
      state.succeed('已上傳');

      expect(seen).not.toContain('busy');
    });

    test('still confirms, on the spot', () => {
      const state = createActionState();

      state.begin();
      advance(30);
      state.succeed('已上傳 · 3.2 MB');

      expect(state.phase()).toEqual({ kind: 'done', message: '已上傳 · 3.2 MB' });
    });
  });

  describe('an action that takes a while', () => {
    test('shows busy once it has been going for a moment', () => {
      const state = createActionState();

      state.begin();
      expect(kind(state)).toBe('idle');

      advance(BUSY_AFTER_MS);
      expect(kind(state)).toBe('busy');
    });

    test('stays busy until it finishes', () => {
      const state = createActionState();

      state.begin();
      advance(60_000);

      expect(kind(state)).toBe('busy');
    });

    test('goes from busy to its confirmation', () => {
      const state = createActionState();

      state.begin();
      advance(BUSY_AFTER_MS + MIN_BUSY_MS + 1000);
      state.succeed('補上 0.5 km²');

      expect(state.phase()).toEqual({ kind: 'done', message: '補上 0.5 km²' });
    });

    // A spinner that appears and is gone 30 ms later reads as a glitch, not as
    // progress. Once busy has been shown it is kept up for a minimum time.
    test('keeps busy up for a minimum time once shown, however soon the work ends', () => {
      const state = createActionState();

      state.begin();
      advance(BUSY_AFTER_MS);
      advance(20);
      state.succeed('完成');

      expect(kind(state)).toBe('busy');

      advance(MIN_BUSY_MS - 20 - 1);
      expect(kind(state)).toBe('busy');

      advance(1);
      expect(state.phase()).toEqual({ kind: 'done', message: '完成' });
    });

    test('does not hold it any longer than that if it ran long anyway', () => {
      const state = createActionState();

      state.begin();
      advance(BUSY_AFTER_MS + MIN_BUSY_MS + 500);
      state.succeed('完成');

      expect(kind(state)).toBe('done');
    });
  });

  describe('the confirmation', () => {
    test('is held for a while and then gives way to idle', () => {
      const state = createActionState();
      state.begin();
      state.succeed('完成');

      advance(DONE_HOLD_MS - 1);
      expect(kind(state)).toBe('done');

      advance(1);
      expect(kind(state)).toBe('idle');
    });

    test('is counted from when it appears, not from when the action finished', () => {
      const state = createActionState();

      state.begin();
      advance(BUSY_AFTER_MS);
      state.succeed('完成'); // appears MIN_BUSY_MS later
      advance(MIN_BUSY_MS);
      expect(kind(state)).toBe('done');

      advance(DONE_HOLD_MS - 1);
      expect(kind(state)).toBe('done');
      advance(1);
      expect(kind(state)).toBe('idle');
    });
  });

  describe('an action with nothing to say', () => {
    test('goes straight back to idle', () => {
      const state = createActionState();

      state.begin();
      advance(10);
      state.succeed(null);

      expect(kind(state)).toBe('idle');
    });

    test('but not before busy has been up long enough', () => {
      const state = createActionState();

      state.begin();
      advance(BUSY_AFTER_MS + 10);
      state.succeed(null);
      expect(kind(state)).toBe('busy');

      advance(MIN_BUSY_MS);
      expect(kind(state)).toBe('idle');
    });
  });

  describe('a failure', () => {
    test('goes back to idle at once: the error is shown by a dialog, not here', () => {
      const state = createActionState();

      state.begin();
      advance(BUSY_AFTER_MS + 10);
      state.fail();

      expect(kind(state)).toBe('idle');
    });

    test('does not leave a late confirmation behind', () => {
      const state = createActionState();

      state.begin();
      advance(BUSY_AFTER_MS + 10);
      state.fail();
      advance(60_000);

      expect(kind(state)).toBe('idle');
    });
  });

  describe('starting again', () => {
    test('while a confirmation is showing, starts afresh and is not cut short by the old timer', () => {
      const state = createActionState();
      state.begin();
      state.succeed('第一次');
      advance(1000);

      state.begin();
      advance(BUSY_AFTER_MS);
      expect(kind(state)).toBe('busy');

      // The first confirmation's hold runs out about a second from now, while
      // this one is still busy; if it were still ticking it would clear busy.
      advance(DONE_HOLD_MS);
      expect(kind(state)).toBe('busy');
    });

    test('does not let a finished earlier action settle a later one', () => {
      const state = createActionState();

      state.begin();
      state.fail();
      state.begin();
      advance(BUSY_AFTER_MS);

      expect(kind(state)).toBe('busy');
    });
  });

  describe('listening', () => {
    test('says so whenever what to show changes', () => {
      const state = createActionState();
      const seen: string[] = [];
      state.subscribe(() => seen.push(kind(state)));

      state.begin();
      advance(BUSY_AFTER_MS);
      advance(MIN_BUSY_MS);
      state.succeed('完成');
      advance(DONE_HOLD_MS);

      expect(seen).toEqual(['busy', 'done', 'idle']);
    });

    test('says nothing when nothing changed', () => {
      const state = createActionState();
      const listener = vi.fn();
      state.subscribe(listener);

      state.fail();
      state.succeed(null);

      expect(listener).not.toHaveBeenCalled();
    });

    // useSyncExternalStore compares snapshots with Object.is: a fresh object on
    // every read would be a change every time, and a render loop.
    test('hands back the very same phase object until it changes', () => {
      const state = createActionState();
      expect(state.phase()).toBe(state.phase());

      state.begin();
      advance(BUSY_AFTER_MS);
      const busy = state.phase();

      expect(state.phase()).toBe(busy);
    });

    test('stops telling a listener that has gone', () => {
      const state = createActionState();
      const listener = vi.fn();
      const stop = state.subscribe(listener);

      stop();
      state.begin();
      advance(BUSY_AFTER_MS);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  test('says nothing more once disposed, and leaves no timer running', () => {
    const state = createActionState();
    const listener = vi.fn();
    state.subscribe(listener);

    state.begin();
    state.dispose();
    advance(60_000);

    expect(listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('runAction', () => {
  const ok = (message: string | null): Promise<ActionResult> => Promise.resolve({ ok: true, message });

  test('begins, does the work, and confirms with what the work said', async () => {
    const state = createActionState();

    await runAction(state, () => ok('已上傳 · 3.2 MB'));

    expect(state.phase()).toEqual({ kind: 'done', message: '已上傳 · 3.2 MB' });
  });

  test('is busy while the work is going and not before it was asked for', async () => {
    const state = createActionState();
    let finish!: (result: ActionResult) => void;

    const running = runAction(state, () => new Promise<ActionResult>((resolve) => (finish = resolve)));
    advance(BUSY_AFTER_MS);
    expect(kind(state)).toBe('busy');

    finish({ ok: true, message: '完成' });
    await running;
    advance(MIN_BUSY_MS);
    expect(kind(state)).toBe('done');
  });

  test('goes back to idle when the work reports a failure', async () => {
    const state = createActionState();

    await runAction(state, () => Promise.resolve({ ok: false }));

    expect(kind(state)).toBe('idle');
  });

  // Whatever the button was waiting on, it must never be left spinning.
  test('goes back to idle when the work throws, and lets the error through', async () => {
    const state = createActionState();

    await expect(
      runAction(state, () => Promise.reject(new Error('no network'))),
    ).rejects.toThrow('no network');

    expect(kind(state)).toBe('idle');
    advance(60_000);
    expect(kind(state)).toBe('idle');
  });

  describe('with a question to ask first', () => {
    test('does nothing at all if the answer is no', async () => {
      const state = createActionState();
      const work = vi.fn(() => ok('不該執行'));

      await runAction(state, work, () => Promise.resolve(false));
      advance(60_000);

      expect(work).not.toHaveBeenCalled();
      expect(kind(state)).toBe('idle');
    });

    test('is not busy while the question is being asked', async () => {
      const state = createActionState();
      let answer!: (yes: boolean) => void;

      const running = runAction(
        state,
        () => ok('完成'),
        () => new Promise<boolean>((resolve) => (answer = resolve)),
      );
      advance(60_000);
      expect(kind(state)).toBe('idle');

      answer(true);
      await running;
      expect(kind(state)).toBe('done');
    });
  });
});
