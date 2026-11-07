import { describe, expect, test, vi } from 'vitest';
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
    depDate: '2026-12-01',
    scheduleSource: 'api',
    airlineCode: 'CI',
    airlineName: 'China Airlines',
    depIata: 'TPE',
    arrIata: 'PVG',
    depScheduledUtc: 1767141900000,
    arrScheduledUtc: 1767149400000,
    depTz: 'Asia/Taipei',
    arrTz: 'Asia/Shanghai',
    status: 'SCHEDULED',
    distanceKm: 420,
    durationMinutes: 125,
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

    // Only an arrival finishes a flight, and "Unknown" or "Diverted" never says
    // so: without a limit that flight is asked about, at a price, for ever.
    test('stops a day after the scheduled arrival, whatever the API last said', () => {
      const DAY = 24 * 3600 * 1000;
      const landed = (ago: number) =>
        createMockFlight({
          depScheduledUtc: now - ago - 3 * 3600 * 1000,
          arrScheduledUtc: now - ago,
          lastSyncedAt: now - DAY,
        });

      expect(shouldPollFlight(landed(DAY - 1), now)).toBe(true);
      expect(shouldPollFlight(landed(DAY + 1), now)).toBe(false);
      expect(shouldPollFlight({ ...landed(DAY + 1), lastSyncedAt: null }, now)).toBe(false);
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

    // A clock cannot say a flight was flown. It may have been cancelled, or
    // missed, and a finished flight goes into the passport.
    describe('when nothing comes back (offline, no key, not found)', () => {
      const nothing: FlightStatusPort = { fetchFlightStatus: async () => null };

      test('hands back the very same flight, so the caller can tell nothing was learned', async () => {
        const flight = createMockFlight({ status: 'DELAYED' });
        expect(await syncFlightStatus(flight, nothing, now)).toBe(flight);
      });

      test('does not land a flight whose arrival time has passed', async () => {
        const past = createMockFlight({
          depScheduledUtc: now - 4 * 3600 * 1000,
          arrScheduledUtc: now - 3600 * 1000,
        });
        const after = await syncFlightStatus(past, nothing, now);
        expect(after.status).toBe('SCHEDULED');
        expect(after.isFinished).toBe(false);
      });

      test('leaves a cancelled flight cancelled', async () => {
        const cancelled = createMockFlight({
          status: 'CANCELLED',
          arrScheduledUtc: now - 3600 * 1000,
        });
        expect((await syncFlightStatus(cancelled, nothing, now)).status).toBe('CANCELLED');
      });

      test('does not count as a sync: the next refresh asks again', async () => {
        const flight = createMockFlight({ lastSyncedAt: null });
        expect((await syncFlightStatus(flight, nothing, now)).lastSyncedAt).toBeNull();
      });

      test('a port that throws is the same as one that found nothing', async () => {
        const flight = createMockFlight({});
        const broken: FlightStatusPort = {
          fetchFlightStatus: async () => {
            throw new Error('offline');
          },
        };
        expect(await syncFlightStatus(flight, broken, now)).toBe(flight);
      });
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

    describe('looking a flight up', () => {
      const answer = {
        number: 'JX 871',
        status: 'Expected',
        greatCircleDistance: { km: 640.5 },
        airline: { name: 'Starlux Airlines', iata: 'JX' },
        departure: {
          airport: {
            iata: 'OKA',
            municipalityName: 'Naha',
            countryCode: 'JP',
            timeZone: 'Asia/Tokyo',
            location: { lat: 26.2, lon: 127.65 },
          },
          scheduledTime: { utc: '2027-03-03 06:25Z', local: '2027-03-03 15:25+09:00' },
          terminal: 'I',
          gate: '5',
        },
        arrival: {
          airport: {
            iata: 'TPE',
            municipalityName: 'Taipei',
            countryCode: 'TW',
            timeZone: 'Asia/Taipei',
            location: { lat: 25.08, lon: 121.23 },
          },
          scheduledTime: { utc: '2027-03-03 08:10Z', local: '2027-03-03 16:10+08:00' },
          terminal: '1',
        },
      };

      test('asks for that number on that date', async () => {
        const seen: string[] = [];
        const port = createAeroDataBoxPort('key', fakeFetch([answer], seen));

        await port.findFlights('jx871', '2027-03-03');

        expect(seen[0]).toMatch(/\/flights\/number\/JX871\/2027-03-03/);
      });

      test('gives everything a flight needs, the airports included', async () => {
        const port = createAeroDataBoxPort('key', fakeFetch([answer]));

        const [flight] = await port.findFlights('JX871', '2027-03-03');

        expect(flight).toEqual({
          flightNumber: 'JX871',
          airlineCode: 'JX',
          airlineName: 'Starlux Airlines',
          depIata: 'OKA',
          arrIata: 'TPE',
          depScheduledUtc: Date.UTC(2027, 2, 3, 6, 25),
          arrScheduledUtc: Date.UTC(2027, 2, 3, 8, 10),
          depTz: 'Asia/Tokyo',
          arrTz: 'Asia/Taipei',
          depTerminal: 'I',
          arrTerminal: '1',
          depCity: 'Naha',
          arrCity: 'Taipei',
          depCountry: 'JP',
          arrCountry: 'TW',
          depLat: 26.2,
          depLon: 127.65,
          arrLat: 25.08,
          arrLon: 121.23,
          distanceKm: 640.5,
          depGate: '5',
          arrGate: null,
          status: 'SCHEDULED',
        });
      });

      test('works the distance out from the airports if the answer leaves it out', async () => {
        const { greatCircleDistance: _left, ...noDistance } = answer;
        const port = createAeroDataBoxPort('key', fakeFetch([noDistance]));

        const [flight] = await port.findFlights('JX871', '2027-03-03');

        expect(flight.distanceKm).toBeGreaterThan(600);
        expect(flight.distanceKm).toBeLessThan(700);
      });

      test('gives every leg of a number that flies several', async () => {
        const port = createAeroDataBoxPort('key', fakeFetch([answer, answer]));

        expect(await port.findFlights('JX871', '2027-03-03')).toHaveLength(2);
      });

      // Without these there is no time to show on any clock.
      test('leaves out a leg with no time zone or no schedule', async () => {
        const noZone = {
          ...answer,
          departure: { ...answer.departure, airport: { iata: 'OKA' } },
        };
        const noTime = {
          ...answer,
          arrival: { ...answer.arrival, scheduledTime: null },
        };
        const port = createAeroDataBoxPort('key', fakeFetch([noZone, noTime]));

        expect(await port.findFlights('JX871', '2027-03-03')).toEqual([]);
      });

      test('gives nothing with no key, and asks nobody', async () => {
        const seen: string[] = [];
        const port = createAeroDataBoxPort(undefined, fakeFetch([answer], seen));

        expect(await port.findFlights('JX871', '2027-03-03')).toEqual([]);
        expect(seen).toEqual([]);
      });

      test('gives nothing when the request fails', async () => {
        const failing = (async () => ({ ok: false })) as unknown as typeof fetch;

        expect(await createAeroDataBoxPort('key', failing).findFlights('JX871', '2027-03-03')).toEqual([]);
      });
    });

    // Trips is the first page: a request that never answers must not hold it up.
    test('gives up on a request that does not answer, and says nothing came back', async () => {
      vi.useFakeTimers();
      try {
        const hanging = ((_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          })) as unknown as typeof fetch;

        const pending = createAeroDataBoxPort('key', hanging).fetchFlightStatus(
          'BR198',
          '2026-12-01',
          'TPE',
        );
        await vi.advanceTimersByTimeAsync(60_000);

        expect(await pending).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    test('an airborne flight is in the air and not yet finished', async () => {
      const port = createAeroDataBoxPort('key', fakeFetch([leg('TPE')]));
      const update = await port.fetchFlightStatus('BR198', '2026-12-01', 'TPE');
      expect(update?.status).toBe('IN_AIR');
      expect(update?.isFinished).toBeUndefined();
    });
  });
});
