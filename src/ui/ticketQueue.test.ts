import { describe, expect, test } from 'vitest';
import type { TicketFacts } from '../flights/ticketFacts';
import { waitingAfterShowing } from './ticketQueue';

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
