import { describe, expect, test, vi } from 'vitest';
import { createAfterClose } from './afterClose';

describe('createAfterClose', () => {
  test('does nothing until the sheet has gone', () => {
    const work = vi.fn();
    const later = createAfterClose();

    later.add(work);

    expect(work).not.toHaveBeenCalled();
  });

  test('does the work once it has, in order', () => {
    const done: string[] = [];
    const later = createAfterClose();

    later.add(() => done.push('first'));
    later.add(() => done.push('second'));
    later.run();

    expect(done).toEqual(['first', 'second']);
  });

  test('does it only once', () => {
    const work = vi.fn();
    const later = createAfterClose();

    later.add(work);
    later.run();
    later.run();

    expect(work).toHaveBeenCalledTimes(1);
  });

  test('still does the rest when one piece throws', () => {
    const work = vi.fn();
    const later = createAfterClose();

    later.add(() => {
      throw new Error('no');
    });
    later.add(work);

    expect(() => later.run()).toThrow('no');
    expect(work).toHaveBeenCalled();
  });
});
