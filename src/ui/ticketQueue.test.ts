import { describe, expect, test, vi } from 'vitest';
import type { TicketFacts } from '../flights/ticketFacts';
import { createAfterClose } from './afterClose';
import { finishSave, waitingAfterShowing } from './ticketQueue';

const leg = (flightNumber: string): TicketFacts => ({
  flightNumber,
  date: '2026-12-01',
  time: null,
  seat: null,
  yearGuessed: false,
});

describe('waitingAfterShowing', () => {
  test('a new ticket queues the legs after the first', () => {
    expect(waitingAfterShowing([], [leg('B'), leg('C')], false)).toEqual([leg('B'), leg('C')]);
  });

  // 查詢 asks again about the leg on screen. It used to replace the queue with
  // what came after that one leg — nothing — and the ticket's other legs were
  // gone until the picture was read again.
  test('查詢 keeps the legs still waiting', () => {
    expect(waitingAfterShowing([leg('B'), leg('C')], [], true)).toEqual([leg('B'), leg('C')]);
  });
});

describe('finishSave', () => {
  function steps() {
    return { advance: vi.fn(async () => {}), clear: vi.fn(), close: vi.fn() };
  }

  test('with legs still waiting, it shows the next and leaves the sheet open', async () => {
    const afterClose = createAfterClose();
    const s = steps();

    expect(await finishSave([leg('B')], afterClose, s)).toBe('next');
    expect(s.advance).toHaveBeenCalledWith([leg('B')]);
    expect(s.close).not.toHaveBeenCalled();
  });

  // Closed with a leg still waiting, the sheet kept the ticket attached, and the
  // next flight added — any flight, a week later — had it copied onto it.
  test('closing after a leg has been saved clears the sheet, once it has slid away', async () => {
    const afterClose = createAfterClose();
    const s = steps();
    await finishSave([leg('B')], afterClose, s);

    expect(s.clear).not.toHaveBeenCalled();
    afterClose.run();
    expect(s.clear).toHaveBeenCalledTimes(1);
  });

  test('the last leg closes the sheet and clears it once it has slid away', async () => {
    const afterClose = createAfterClose();
    const s = steps();

    expect(await finishSave([], afterClose, s)).toBe('closed');
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(s.clear).not.toHaveBeenCalled();
    afterClose.run();
    expect(s.clear).toHaveBeenCalledTimes(1);
  });
});
