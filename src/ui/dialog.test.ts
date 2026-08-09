import { beforeEach, describe, expect, test, vi } from 'vitest';
import { answer, ask, current, reset, subscribe } from './dialog';

beforeEach(() => {
  reset();
});

describe('ask', () => {
  test('shows nothing until something is asked', () => {
    expect(current()).toBeNull();
  });

  test('makes the request the current one', async () => {
    void ask({ title: '刪掉？', confirmLabel: '刪除' });

    expect(current()).toMatchObject({ title: '刪掉？', confirmLabel: '刪除' });
  });

  test('resolves true when confirmed', async () => {
    const answered = ask({ title: '刪掉？', confirmLabel: '刪除' });
    answer(current()!.id, true);

    expect(await answered).toBe(true);
  });

  test('resolves false when dismissed', async () => {
    const answered = ask({ title: '刪掉？', confirmLabel: '刪除' });
    answer(current()!.id, false);

    expect(await answered).toBe(false);
  });

  test('clears itself once answered', async () => {
    const answered = ask({ title: '刪掉？', confirmLabel: '刪除' });
    answer(current()!.id, true);
    await answered;

    expect(current()).toBeNull();
  });

  test('gives each request its own id', () => {
    void ask({ title: 'A', confirmLabel: '好' });
    const first = current()!.id;
    answer(first, true);
    void ask({ title: 'B', confirmLabel: '好' });

    expect(current()!.id).not.toBe(first);
  });
});

describe('queueing', () => {
  test('a second request waits rather than replacing the first', () => {
    void ask({ title: '第一個', confirmLabel: '好' });
    void ask({ title: '第二個', confirmLabel: '好' });

    expect(current()?.title).toBe('第一個');
  });

  test('the queued request appears once the first is answered', async () => {
    const first = ask({ title: '第一個', confirmLabel: '好' });
    void ask({ title: '第二個', confirmLabel: '好' });

    answer(current()!.id, true);
    await first;

    expect(current()?.title).toBe('第二個');
  });

  test('answers go to the right request', async () => {
    const first = ask({ title: '第一個', confirmLabel: '好' });
    const second = ask({ title: '第二個', confirmLabel: '好' });

    answer(current()!.id, false);
    expect(await first).toBe(false);

    answer(current()!.id, true);
    expect(await second).toBe(true);
  });

  test('ignores an answer for a request that is not on screen', async () => {
    // A stale tap from a dialog that has already gone must not dismiss the one
    // that replaced it.
    const first = ask({ title: '第一個', confirmLabel: '好' });
    void ask({ title: '第二個', confirmLabel: '好' });

    answer(999, true);

    expect(current()?.title).toBe('第一個');
    answer(current()!.id, true);
    await first;
  });
});

describe('subscribe', () => {
  test('tells a listener when something is asked', () => {
    const listener = vi.fn();
    subscribe(listener);

    void ask({ title: '刪掉？', confirmLabel: '刪除' });

    expect(listener).toHaveBeenCalled();
  });

  test('tells a listener when the dialog goes away', async () => {
    const listener = vi.fn();
    const answered = ask({ title: '刪掉？', confirmLabel: '刪除' });
    subscribe(listener);

    answer(current()!.id, true);
    await answered;

    expect(listener).toHaveBeenCalled();
  });

  test('stops telling a listener that unsubscribed', () => {
    const listener = vi.fn();
    subscribe(listener)();

    void ask({ title: '刪掉？', confirmLabel: '刪除' });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('defaults', () => {
  test('is a plain notice with no cancel button unless one is asked for', () => {
    void ask({ title: '完成', confirmLabel: '好' });

    expect(current()?.cancelLabel).toBeNull();
  });

  test('carries a cancel label when given one', () => {
    void ask({ title: '刪掉？', confirmLabel: '刪除', cancelLabel: '取消' });

    expect(current()?.cancelLabel).toBe('取消');
  });

  test('is not destructive unless said to be', () => {
    void ask({ title: '完成', confirmLabel: '好' });

    expect(current()?.destructive).toBe(false);
  });
});
