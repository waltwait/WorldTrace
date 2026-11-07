import { describe, expect, test } from 'vitest';
import { boardingPassOpen, planReminders, reminderFor } from './reminders';
import type { FlightRecord } from './types';

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 10, 7, 2, 0);
const DEPARTS = NOW + 10 * HOUR;

const flight: FlightRecord = {
  id: 'fl_1',
  flightNumber: 'CI198',
  depDate: '2026-11-07',
  scheduleSource: 'api',
  airlineCode: 'CI',
  airlineName: 'China Airlines',
  depIata: 'TPE',
  arrIata: 'NRT',
  depScheduledUtc: DEPARTS,
  arrScheduledUtc: DEPARTS + 3 * HOUR,
  depTz: 'Asia/Taipei',
  arrTz: 'Asia/Tokyo',
  status: 'SCHEDULED',
  distanceKm: 2180,
  durationMinutes: 180,
  isFinished: false,
  createdAt: NOW,
  seat: null,
};

describe('reminderFor', () => {
  test('is an hour before the flight leaves', () => {
    expect(reminderFor(flight, NOW)?.at).toBe(DEPARTS - HOUR);
  });

  test('says which flight, and what to do', () => {
    const reminder = reminderFor(flight, NOW);

    expect(reminder?.title).toContain('CI198');
    expect(reminder?.body).toContain('登機證');
    expect(reminder?.flightId).toBe('fl_1');
  });

  // Its own departure is the one that matters.
  test('goes by the estimated time when the flight is late', () => {
    const late = { ...flight, depEstimatedUtc: DEPARTS + 2 * HOUR };

    expect(reminderFor(late, NOW)?.at).toBe(DEPARTS + HOUR);
  });

  // Nothing is left to update.
  test('is not needed once there is a seat', () => {
    expect(reminderFor({ ...flight, seat: '22C' }, NOW)).toBeNull();
  });

  test('is not needed for a flight over or cancelled', () => {
    expect(reminderFor({ ...flight, isFinished: true }, NOW)).toBeNull();
    expect(reminderFor({ ...flight, status: 'CANCELLED' }, NOW)).toBeNull();
  });

  test('is not set for a time already gone', () => {
    expect(reminderFor(flight, DEPARTS - HOUR / 2)).toBeNull();
  });

  test('has a name of its own, so a change replaces it rather than adding another', () => {
    expect(reminderFor(flight, NOW)?.id).toBe(reminderFor({ ...flight, depEstimatedUtc: DEPARTS + HOUR }, NOW)?.id);
    expect(reminderFor(flight, NOW)?.id).not.toBe(reminderFor({ ...flight, id: 'fl_2' }, NOW)?.id);
  });
});

describe('planReminders', () => {
  test('gives one for each flight that needs it', () => {
    const flights = [flight, { ...flight, id: 'fl_2', seat: '3E' }, { ...flight, id: 'fl_3' }];

    expect(planReminders(flights, NOW).map((r) => r.flightId)).toEqual(['fl_1', 'fl_3']);
  });
});

describe('boardingPassOpen', () => {
  test('opens an hour before the flight leaves', () => {
    expect(boardingPassOpen(flight, DEPARTS - HOUR - 1)).toBe(false);
    expect(boardingPassOpen(flight, DEPARTS - HOUR)).toBe(true);
  });

  // A pass is in the hand from the gate to the seat; afterwards the seat is typed.
  test('stays open until it lands, though it has left by then', () => {
    const left = { ...flight, isFinished: true };

    expect(boardingPassOpen(left, DEPARTS + 2 * HOUR)).toBe(true);
    expect(boardingPassOpen(left, DEPARTS + 3 * HOUR)).toBe(false);
  });

  test('goes by the estimated times when the flight is late', () => {
    const late = { ...flight, depEstimatedUtc: DEPARTS + 2 * HOUR, arrEstimatedUtc: DEPARTS + 5 * HOUR };

    expect(boardingPassOpen(late, DEPARTS - HOUR)).toBe(false);
    expect(boardingPassOpen(late, DEPARTS + HOUR)).toBe(true);
    expect(boardingPassOpen(late, DEPARTS + 4 * HOUR)).toBe(true);
  });

  // A seat may change at the gate, so one already there does not close it.
  test('is open with a seat already filled in', () => {
    expect(boardingPassOpen({ ...flight, seat: '22C' }, DEPARTS)).toBe(true);
  });

  test('is closed for a flight cancelled', () => {
    expect(boardingPassOpen({ ...flight, status: 'CANCELLED' }, DEPARTS)).toBe(false);
  });
});

describe('a reminder tapped', () => {
  test('goes straight to reading the boarding pass', () => {
    expect(reminderFor(flight, NOW)?.opens).toBe('boardingPass');
  });
});
