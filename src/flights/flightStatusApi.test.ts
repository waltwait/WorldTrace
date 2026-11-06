import { describe, expect, test } from 'vitest';
import {
  createAeroDataBoxPort,
  mapAeroDataBoxStatus,
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

  describe('syncFlightStatus keeps what the API does not know', () => {
    test('a gate, terminal or belt the API leaves empty does not wipe the one already there', async () => {
      const initial = createMockFlight({
        depGate: 'C3',
        arrGate: '18',
        depTerminal: '2',
        arrTerminal: '1',
        baggageBelt: '5',
      });
      const port: FlightStatusPort = {
        fetchFlightStatus: async () => ({
          status: 'SCHEDULED',
          depGate: null,
          arrGate: null,
          depTerminal: null,
          arrTerminal: null,
          baggageBelt: null,
        }),
      };
      const updated = await syncFlightStatus(initial, port, 1767000000000);
      expect([
        updated.depGate,
        updated.arrGate,
        updated.depTerminal,
        updated.arrTerminal,
        updated.baggageBelt,
      ]).toEqual(['C3', '18', '2', '1', '5']);
    });

    test('asks for the departure date on the clocks of the departure airport', async () => {
      // 07:30 on 1 December in Taipei is 23:30 on 30 November in UTC.
      const flight = createMockFlight({
        depScheduledUtc: Date.UTC(2026, 10, 30, 23, 30),
        depTz: 'Asia/Taipei',
      });
      const asked: string[] = [];
      const port: FlightStatusPort = {
        fetchFlightStatus: async (_num, dateLocal) => {
          asked.push(dateLocal);
          return null;
        },
      };
      await syncFlightStatus(flight, port, Date.UTC(2026, 10, 1));
      expect(asked).toEqual(['2026-12-01']);
    });
  });

  describe('mapAeroDataBoxStatus', () => {
    test('reads every status AeroDataBox sends', () => {
      const cases: Array<[string, string | undefined]> = [
        ['Expected', 'SCHEDULED'],
        ['CheckIn', 'SCHEDULED'],
        ['Boarding', 'BOARDING'],
        ['GateClosed', 'BOARDING'],
        ['Departed', 'IN_AIR'],
        ['EnRoute', 'IN_AIR'],
        ['Approaching', 'IN_AIR'],
        ['Arrived', 'LANDED'],
        ['Delayed', 'DELAYED'],
        ['Canceled', 'CANCELLED'],
      ];
      for (const [raw, expected] of cases) {
        expect([raw, mapAeroDataBoxStatus(raw)]).toEqual([raw, expected]);
      }
    });

    test('says nothing for a status it cannot represent, rather than calling it scheduled', () => {
      // CanceledUncertain is only "probably": calling it cancelled would stop
      // polling for good. Diverted has no status here to map to.
      for (const raw of ['Unknown', 'CanceledUncertain', 'Diverted', '', 'something new']) {
        expect(mapAeroDataBoxStatus(raw)).toBeUndefined();
      }
    });
  });

  describe('createAeroDataBoxPort', () => {
    function fakeFetch(body: unknown, seen: string[] = []) {
      return (async (url: string) => {
        seen.push(url);
        return { ok: true, status: 200, json: async () => body };
      }) as unknown as typeof fetch;
    }

    const leg = (from: string, extra: Record<string, unknown> = {}) => ({
      status: 'EnRoute',
      departure: { airport: { iata: from }, ...extra },
      arrival: { airport: { iata: 'XXX' } },
    });

    test('asks for the flight number on the local date it was given', async () => {
      const seen: string[] = [];
      const port = createAeroDataBoxPort('key', fakeFetch([leg('TPE')], seen));
      await port.fetchFlightStatus('br198', '2026-12-01', 'TPE');
      expect(seen[0]).toMatch(/\/flights\/number\/BR198\/2026-12-01/);
    });

    test('takes the leg that leaves from the flight\'s own airport', async () => {
      const body = [leg('NRT', { gate: '71' }), leg('TPE', { gate: 'B7' })];
      const port = createAeroDataBoxPort('key', fakeFetch(body));
      const update = await port.fetchFlightStatus('BR198', '2026-12-01', 'TPE');
      expect(update?.depGate).toBe('B7');
    });

    test('gives nothing when no leg leaves from that airport, rather than another flight\'s status', async () => {
      const port = createAeroDataBoxPort('key', fakeFetch([leg('NRT', { gate: '71' })]));
      expect(await port.fetchFlightStatus('BR198', '2026-12-01', 'TPE')).toBeNull();
    });

    test('an airborne flight is in the air and not yet finished', async () => {
      const port = createAeroDataBoxPort('key', fakeFetch([leg('TPE')]));
      const update = await port.fetchFlightStatus('BR198', '2026-12-01', 'TPE');
      expect(update?.status).toBe('IN_AIR');
      expect(update?.isFinished).toBeUndefined();
    });
  });
});
