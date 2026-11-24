/**
 * Flight status tracking and tiered polling scheduler.
 */

import { cleanFlightNumber } from './flightNumber';
import { calculateFlightKm } from './greatCircle';
import type { FlightRecord, FlightStatus, LookedUpFlight } from './types';
import { utcToLocal } from './zonedTime';

export interface FlightStatusUpdate {
  status?: FlightStatus;
  depEstimatedUtc?: number | null;
  arrEstimatedUtc?: number | null;
  depTerminal?: string | null;
  arrTerminal?: string | null;
  depGate?: string | null;
  arrGate?: string | null;
  baggageBelt?: string | null;
  isFinished?: boolean;
}

export interface FlightStatusPort {
  /**
   * `dateLocal` is the departure date on the departure airport's clocks, which
   * is what a flight number is scheduled by; `depIata` picks the right leg of
   * a number that flies several.
   */
  fetchFlightStatus(
    flightNumber: string,
    dateLocal: string,
    depIata: string,
  ): Promise<FlightStatusUpdate | null>;
}

export interface FlightLookupPort {
  /**
   * Every leg that number flies on that day at its origin; none if unknown.
   * Null when no answer came back — offline, a timeout, a spent quota, a server
   * error — which says nothing about the flight and must not be taken as none.
   */
  findFlights(flightNumber: string, dateLocal: string): Promise<LookedUpFlight[] | null>;
  /** The local dates that number has flown on, as far as the API will say; null if not. */
  flightDates?(flightNumber: string): Promise<string[] | null>;
}

/**
 * Only an arrival finishes a flight, and an API that keeps saying "Unknown" or
 * "Diverted" never gives one. A day past the schedule covers any real delay;
 * after that a poll costs money and will not say anything new, and the flight
 * waits for the user to mark it.
 */
const STOP_POLLING_AFTER_ARRIVAL_MS = 24 * 3600 * 1000;

/** What a request answers when the API refused it as asked: that day has nothing. */
const REFUSED = Symbol('refused');

/** Trips is the first page: a request that hangs must not hold it up. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A flight whose schedule was borrowed from another day or typed by hand is one
 * the API had no timetable for on its own date. Live feeds only start near
 * departure, so polling months ahead would get 204 on every launch and spend
 * quota without ever stamping `lastSyncedAt`.
 */
const POLL_UNFILED_WITHIN_MS = 7 * 24 * 3600 * 1000;

/**
 * Determines whether a flight is due for a status poll based on its tiered schedule.
 * - > 48h before departure: every 24 hours (only within 7d if scheduleSource !== 'api')
 * - 24h ~ 48h before departure: every 4 hours
 * - 6h ~ 24h before departure: every 2 hours
 * - < 6h before departure up to landing: every 15 minutes
 * - more than a day past the scheduled arrival: never again
 */
export function shouldPollFlight(flight: FlightRecord, nowMs: number = Date.now()): boolean {
  if (flight.isFinished || flight.status === 'CANCELLED') {
    return false;
  }

  if (nowMs > flight.arrScheduledUtc + STOP_POLLING_AFTER_ARRIVAL_MS) {
    return false;
  }

  const msUntilDep = flight.depScheduledUtc - nowMs;
  if (flight.scheduleSource !== 'api' && msUntilDep > POLL_UNFILED_WITHIN_MS) {
    return false;
  }

  if (flight.lastSyncedAt === null || flight.lastSyncedAt === undefined) {
    return true;
  }

  const msSinceLastSync = nowMs - flight.lastSyncedAt;

  if (msUntilDep > 48 * 3600 * 1000) {
    return msSinceLastSync >= 24 * 3600 * 1000;
  }

  if (msUntilDep > 24 * 3600 * 1000) {
    return msSinceLastSync >= 4 * 3600 * 1000;
  }

  if (msUntilDep > 6 * 3600 * 1000) {
    return msSinceLastSync >= 2 * 3600 * 1000;
  }

  // < 6h or in flight
  return msSinceLastSync >= 15 * 60 * 1000;
}

/**
 * Synchronizes a flight record with live status from the given port.
 *
 * When nothing comes back this hands back the very same flight, so a caller can
 * tell nothing was learned. It used to work a status out from the clock, which
 * landed and finished a flight the moment its arrival time passed: cancelled,
 * missed or simply offline, it went into the passport as flown. It is also not
 * stamped as synced, or one offline moment would put off the next poll a day.
 */
export async function syncFlightStatus(
  flight: FlightRecord,
  port: FlightStatusPort,
  nowMs: number = Date.now(),
): Promise<FlightRecord> {
  // A flight number is scheduled by the local date at its origin: the UTC
  // date of a 07:30 Taipei departure is the day before, and asking for that
  // day returns yesterday's flight or nothing.
  const dateLocal = utcToLocal(flight.depScheduledUtc, flight.depTz).date;
  let update: FlightStatusUpdate | null = null;

  try {
    update = await port.fetchFlightStatus(flight.flightNumber, dateLocal, flight.depIata);
  } catch {
    update = null;
  }

  if (!update) return flight;

  // Null from the API means it does not know yet — a gate is assigned hours
  // before departure — not that there is none. Taking it as a value wiped
  // the gate the user had typed in on every poll a day out.
  return {
    ...flight,
    status: update.status ?? flight.status,
    depEstimatedUtc: update.depEstimatedUtc ?? flight.depEstimatedUtc,
    arrEstimatedUtc: update.arrEstimatedUtc ?? flight.arrEstimatedUtc,
    depTerminal: update.depTerminal ?? flight.depTerminal,
    arrTerminal: update.arrTerminal ?? flight.arrTerminal,
    depGate: update.depGate ?? flight.depGate,
    arrGate: update.arrGate ?? flight.arrGate,
    baggageBelt: update.baggageBelt ?? flight.baggageBelt,
    isFinished: update.isFinished ?? flight.isFinished,
    lastSyncedAt: nowMs,
  };
}

/**
 * AeroDataBox's flight progress status, as one of ours.
 *
 * Undefined where there is no honest equivalent, so a sync keeps the status
 * it had: "Unknown", "Diverted" (no status here for it), and
 * "CanceledUncertain", which is only probably cancelled — calling it
 * cancelled would stop polling for good. The first version matched
 * substrings of the wrong names ("en-route", "active"), so EnRoute and
 * Departed fell through to SCHEDULED and overwrote IN_AIR for the whole
 * flight.
 */
export function mapAeroDataBoxStatus(raw: string | null | undefined): FlightStatus | undefined {
  switch (raw) {
    case 'Expected':
    case 'CheckIn':
      return 'SCHEDULED';
    case 'Boarding':
    case 'GateClosed':
      return 'BOARDING';
    case 'Departed':
    case 'EnRoute':
    case 'Approaching':
      return 'IN_AIR';
    case 'Arrived':
      return 'LANDED';
    case 'Delayed':
      return 'DELAYED';
    case 'Canceled':
      return 'CANCELLED';
    default:
      return undefined;
  }
}

interface AeroDataBoxMovement {
  airport?: {
    iata?: string | null;
    municipalityName?: string | null;
    countryCode?: string | null;
    timeZone?: string | null;
    location?: { lat?: number | null; lon?: number | null } | null;
  } | null;
  scheduledTime?: { utc?: string | null } | null;
  terminal?: string | null;
  gate?: string | null;
  baggageBelt?: string | null;
}

interface AeroDataBoxLeg {
  status?: string | null;
  airline?: { name?: string | null } | null;
  greatCircleDistance?: { km?: number | null } | null;
  departure?: AeroDataBoxMovement | null;
  arrival?: AeroDataBoxMovement | null;
}

/** "2027-03-03 06:25Z", which is not a format every engine's Date will read. */
function parseApiUtc(text: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?Z$/.exec(text ?? '');
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

function position(movement: AeroDataBoxMovement | null | undefined) {
  const { lat, lon } = movement?.airport?.location ?? {};
  return typeof lat === 'number' && typeof lon === 'number' ? { lat, lon } : null;
}

/**
 * A flight from one leg of the answer, or null if it lacks what every flight
 * needs. The airports' names, places and zones are all from here: the app keeps
 * no table of airports of its own.
 */
function toLookedUpFlight(leg: AeroDataBoxLeg, flightNumber: string): LookedUpFlight | null {
  const { departure, arrival } = leg;
  const depIata = departure?.airport?.iata;
  const arrIata = arrival?.airport?.iata;
  const depTz = departure?.airport?.timeZone;
  const arrTz = arrival?.airport?.timeZone;
  const depScheduledUtc = parseApiUtc(departure?.scheduledTime?.utc);
  const arrScheduledUtc = parseApiUtc(arrival?.scheduledTime?.utc);
  if (!depIata || !arrIata || !depTz || !arrTz || !depScheduledUtc || !arrScheduledUtc) return null;

  const from = position(departure);
  const to = position(arrival);
  const airlineCode = flightNumber.slice(0, 2);

  return {
    flightNumber,
    airlineCode,
    airlineName: leg.airline?.name || airlineCode,
    depIata,
    arrIata,
    depScheduledUtc,
    arrScheduledUtc,
    depTz,
    arrTz,
    depTerminal: departure?.terminal ?? null,
    arrTerminal: arrival?.terminal ?? null,
    depCity: departure?.airport?.municipalityName ?? null,
    arrCity: arrival?.airport?.municipalityName ?? null,
    depCountry: departure?.airport?.countryCode ?? null,
    arrCountry: arrival?.airport?.countryCode ?? null,
    depLat: from?.lat ?? null,
    depLon: from?.lon ?? null,
    arrLat: to?.lat ?? null,
    arrLon: to?.lon ?? null,
    distanceKm: leg.greatCircleDistance?.km ?? (from && to ? calculateFlightKm(from, to) : null),
    depGate: departure?.gate ?? null,
    arrGate: arrival?.gate ?? null,
    status: mapAeroDataBoxStatus(leg.status) ?? 'SCHEDULED',
  };
}

/**
 * HTTP provider for AeroDataBox (via RapidAPI). `fetchFn` is injectable so
 * the response handling runs under test without touching the network.
 */
export function createAeroDataBoxPort(
  apiKey?: string,
  fetchFn: typeof fetch = fetch,
): FlightStatusPort & Required<FlightLookupPort> {
  /** The answer to a request, or null for none. Never throws. */
  async function request(path: string): Promise<unknown> {
    if (!apiKey) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetchFn(`https://aerodatabox.p.rapidapi.com${path}`, {
        signal: controller.signal,
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
        },
      });

      if (!res.ok) {
        // The status is the only thing that tells a refused date from a spent quota.
        console.warn('[WorldTrace] flight lookup refused', res.status);
        // A date outside the API's year (400), or a number it does not know,
        // is an answer: nothing there. Anything else is no answer at all.
        return res.status === 400 || res.status === 404 ? REFUSED : null;
      }

      // 204, nothing known, has no body to read; returning [] tells an empty
      // schedule apart from a failed request (null).
      if (res.status === 204) return [];
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  const numberPath = (flightNumber: string) =>
    `/flights/number/${encodeURIComponent(cleanFlightNumber(flightNumber))}`;

  /** The legs for that number and date, or null for no answer. */
  async function fetchLegs(flightNumber: string, dateLocal: string): Promise<AeroDataBoxLeg[] | null> {
    // Departure, or a flight landing after midnight answers for the day before too,
    // and comes first: a search for the 12th gave the 11th, and a poll that flight's gate.
    const data = (await request(
      `${numberPath(flightNumber)}/${dateLocal}?dateLocalRole=Departure`,
    )) as AeroDataBoxLeg | AeroDataBoxLeg[] | typeof REFUSED | null;
    if (data === REFUSED) return [];
    if (!data) return null;
    return Array.isArray(data) ? data : [data];
  }

  return {
    async fetchFlightStatus(flightNumber, dateLocal, depIata) {
      const legs = await fetchLegs(flightNumber, dateLocal);
      if (!legs) return null;

      // One number can fly several legs on a day (TPE→NRT→HNL). The first
      // leg is not necessarily ours, and another leg's gate is worse than
      // none.
      const from = depIata.trim().toUpperCase();
      const leg = legs.find((l) => l?.departure?.airport?.iata?.toUpperCase() === from);
      if (!leg) return null;

      const status = mapAeroDataBoxStatus(leg.status);
      return {
        status,
        depGate: leg.departure?.gate ?? null,
        arrGate: leg.arrival?.gate ?? null,
        depTerminal: leg.departure?.terminal ?? null,
        arrTerminal: leg.arrival?.terminal ?? null,
        baggageBelt: leg.arrival?.baggageBelt ?? null,
        // Only an arrival finishes a flight; anything else leaves it as it was.
        isFinished: status === 'LANDED' ? true : undefined,
      };
    },

    async flightDates(flightNumber) {
      const data = await request(`${numberPath(flightNumber)}/dates`);
      return Array.isArray(data) && data.every((d) => typeof d === 'string') ? data : null;
    },

    async findFlights(flightNumber, dateLocal) {
      // No key is no question asked: nothing to report, and the sheet asks
      // for a key before it gets here.
      if (!apiKey) return [];
      const legs = await fetchLegs(flightNumber, dateLocal);
      if (legs === null) return null;
      const cleanNum = cleanFlightNumber(flightNumber);
      return legs.flatMap((leg) => toLookedUpFlight(leg, cleanNum) ?? []);
    },
  };
}
