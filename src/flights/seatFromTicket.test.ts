import { describe, expect, test } from 'vitest';
import { seatFromTicket } from './seatFromTicket';
import type { TicketFacts } from './ticketFacts';

const flight = { flightNumber: 'CI198', depDate: '2026-11-07' };
const pass = (fields: Partial<TicketFacts>): TicketFacts => ({
  flightNumber: 'CI198',
  date: '2026-11-07',
  time: null,
  seat: '22C',
  yearGuessed: true,
  ...fields,
});

describe('seatFromTicket', () => {
  test('takes the seat from the boarding pass for this flight', () => {
    expect(seatFromTicket(flight, [pass({})])).toEqual({ ok: true, seat: '22C' });
  });

  test('finds this flight among several on one ticket', () => {
    const tickets = [pass({ flightNumber: 'CI199', seat: '5A' }), pass({})];

    expect(seatFromTicket(flight, tickets)).toEqual({ ok: true, seat: '22C' });
  });

  // A pass for another flight must not change this one.
  test('refuses a pass for another flight, and says which it was', () => {
    const result = seatFromTicket(flight, [pass({ flightNumber: 'BR198' })]);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('BR198');
  });

  test('refuses a pass for this number on another day, and says which day', () => {
    const result = seatFromTicket(flight, [pass({ date: '2026-11-08' })]);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('11/8');
  });

  // A pass prints no year, so the year it was given is only a guess.
  test('goes by the day alone when the year was guessed', () => {
    expect(seatFromTicket(flight, [pass({ date: '2025-11-07', yearGuessed: true })])).toEqual({
      ok: true,
      seat: '22C',
    });
  });

  test('takes a pass with no date on it at its word', () => {
    expect(seatFromTicket(flight, [pass({ date: null })]).ok).toBe(true);
  });

  test('says so when the pass has no seat to give', () => {
    const result = seatFromTicket(flight, [pass({ seat: null })]);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('座位');
  });

  test('says so when nothing could be read', () => {
    expect(seatFromTicket(flight, []).ok).toBe(false);
  });

  test('matches a padded or spaced number', () => {
    expect(seatFromTicket({ ...flight, flightNumber: 'CI 0198' }, [pass({})]).ok).toBe(true);
  });
});
