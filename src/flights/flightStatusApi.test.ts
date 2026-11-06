import { describe, expect, test } from 'vitest';
import {
  shouldPollFlight,
  syncFlightStatus,
  type FlightStatusPort,
  type FlightStatusUpdate,
} from './flightStatusApi';
import type { FlightRecord } from './types';

function createMockFlight(overrides: Partial<FlightRecord>): FlightRecord {
  return {
    id: 'f-1',
    flightNumber: 'CI501',
    airlineCode: 'CI',
    airlineName: 'China Airlines',
    depIata: 'TPE',
    arrIata: 'PVG',
    depScheduledUtc: 1767141900000,
    arrScheduledUtc: 1767149400000,
    depTz: 'Asia/Taipei',
    arrTz: 'Asia/Shanghai',
    status: 'SCHEDULED',
    distanceMiles: 420,
    durationMinutes: 125,
    notificationsEnabled: true,
    isFinished: false,
    createdAt: 1766900000000,
    ...overrides,
  };
}

describe('flightStatusApi', () => {
  describe('shouldPollFlight (tiered polling strategy)', () => {
    const now = 1767000000000;

    test('never polls finished or cancelled flights', () => {
      const finished = createMockFlight({ isFinished: true });
      expect(shouldPollFlight(finished, now)).toBe(false);

      const cancelled = createMockFlight({ status: 'CANCELLED' });
      expect(shouldPollFlight(cancelled, now)).toBe(false);
    });

    test('always polls if never synced before', () => {
      const flight = createMockFlight({
        depScheduledUtc: now + 50 * 3600 * 1000, // > 48h
        lastSyncedAt: null,
      });
      expect(shouldPollFlight(flight, now)).toBe(true);
    });

    test('departure > 48h: polls every 24 hours', () => {
      const flight = createMockFlight({
        depScheduledUtc: now + 60 * 3600 * 1000, // 60h away (> 48h)
        lastSyncedAt: now - 23 * 3600 * 1000, // 23h ago
      });
      expect(shouldPollFlight(flight, now)).toBe(false);

      const due = createMockFlight({
        depScheduledUtc: now + 60 * 3600 * 1000,
        lastSyncedAt: now - 25 * 3600 * 1000, // 25h ago
      });
      expect(shouldPollFlight(due, now)).toBe(true);
    });

    test('departure 24h ~ 48h: polls every 4 hours', () => {
      const flight = createMockFlight({
        depScheduledUtc: now + 30 * 3600 * 1000, // 30h away
        lastSyncedAt: now - 3 * 3600 * 1000, // 3h ago
      });
      expect(shouldPollFlight(flight, now)).toBe(false);

      const due = createMockFlight({
        depScheduledUtc: now + 30 * 3600 * 1000,
        lastSyncedAt: now - 5 * 3600 * 1000, // 5h ago
      });
      expect(shouldPollFlight(due, now)).toBe(true);
    });

    test('departure < 6h: polls every 15 minutes', () => {
      const flight = createMockFlight({
        depScheduledUtc: now + 2 * 3600 * 1000, // 2h away
        lastSyncedAt: now - 10 * 60 * 1000, // 10 mins ago
      });
      expect(shouldPollFlight(flight, now)).toBe(false);

      const due = createMockFlight({
        depScheduledUtc: now + 2 * 3600 * 1000,
        lastSyncedAt: now - 16 * 60 * 1000, // 16 mins ago
      });
      expect(shouldPollFlight(due, now)).toBe(true);
    });
  });

  describe('syncFlightStatus', () => {
    const now = 1767000000000;

    test('updates flight with returned live status from port', async () => {
      const initial = createMockFlight({
        status: 'SCHEDULED',
        depGate: 'D6',
        lastSyncedAt: null,
      });

      const mockPort: FlightStatusPort = {
        fetchFlightStatus: async () => ({
          status: 'BOARDING',
          depGate: 'D8', // Gate change
          depEstimatedUtc: initial.depScheduledUtc + 15 * 60 * 1000, // 15m delay
        }),
      };

      const updated = await syncFlightStatus(initial, mockPort, now);
      expect(updated.status).toBe('BOARDING');
      expect(updated.depGate).toBe('D8');
      expect(updated.depEstimatedUtc).toBe(initial.depScheduledUtc + 15 * 60 * 1000);
      expect(updated.lastSyncedAt).toBe(now);
    });

    test('handles fallback simulation when port returns null (e.g. offline/no API key)', async () => {
      const flightInAir = createMockFlight({
        depScheduledUtc: now - 30 * 60 * 1000, // departed 30m ago
        arrScheduledUtc: now + 60 * 60 * 1000, // arrives in 1h
        status: 'SCHEDULED',
      });

      const mockPort: FlightStatusPort = {
        fetchFlightStatus: async () => null,
      };

      const updated = await syncFlightStatus(flightInAir, mockPort, now);
      expect(updated.status).toBe('IN_AIR');
      expect(updated.lastSyncedAt).toBe(now);

      const flightLanded = createMockFlight({
        depScheduledUtc: now - 4 * 3600 * 1000,
        arrScheduledUtc: now - 1 * 3600 * 1000, // landed 1h ago
        status: 'IN_AIR',
      });

      const updatedLanded = await syncFlightStatus(flightLanded, mockPort, now);
      expect(updatedLanded.status).toBe('LANDED');
      expect(updatedLanded.isFinished).toBe(true);
    });
  });
});
