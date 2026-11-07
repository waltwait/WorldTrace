/**
 * Types for flight tracking, travel documents, and flight passport.
 */

export type FlightStatus =
  | 'SCHEDULED'
  | 'BOARDING'
  | 'IN_AIR'
  | 'LANDED'
  | 'DELAYED'
  | 'CANCELLED';

/**
 * A flight as the app uses it. It is stored by where each thing came from, in
 * three tables joined back together here (store/flights.ts).
 */
export interface FlightRecord {
  // flights: what the user confirmed.
  id: string;
  flightNumber: string; // e.g. "CI501"
  depDate: string; // YYYY-MM-DD on the departure airport's clocks
  depTime?: string | null; // HH:MM, likewise
  seat?: string | null;
  notes?: string | null;
  isFinished: boolean;
  createdAt: number;

  // flight_schedule: the timetable, which does not change.
  scheduleSource: ScheduleSource;
  airlineCode: string; // e.g. "CI"
  airlineName: string; // e.g. "China Airlines"
  depIata: string; // e.g. "TPE"
  arrIata: string; // e.g. "PVG"
  depScheduledUtc: number; // Unix timestamp ms
  arrScheduledUtc: number; // Unix timestamp ms
  depTz: string; // IANA timezone e.g. "Asia/Taipei"
  arrTz: string; // IANA timezone e.g. "Asia/Shanghai"
  depTerminal?: string | null;
  arrTerminal?: string | null;
  depCity?: string | null;
  arrCity?: string | null;
  depCountry?: string | null; // ISO 2-letter, e.g. "TW"
  arrCountry?: string | null;
  depLat?: number | null;
  depLon?: number | null;
  arrLat?: number | null;
  arrLon?: number | null;
  distanceKm?: number | null;
  durationMinutes: number;

  // flight_status: what changes up to the day it flies.
  status: FlightStatus;
  depEstimatedUtc?: number | null;
  arrEstimatedUtc?: number | null;
  depGate?: string | null;
  arrGate?: string | null;
  baggageBelt?: string | null;
  lastSyncedAt?: number | null;
}

/** 'api' for a timetable looked up; 'user' for one typed in when none could be. */
/** `nearby`: too old to look up, so taken from a recent day; see flightLookup.ts. */
export type ScheduleSource = 'api' | 'user' | 'nearby';

/** One flight as the status API describes it. */
export type LookedUpFlight = Pick<
  FlightRecord,
  | 'flightNumber'
  | 'airlineCode'
  | 'airlineName'
  | 'depIata'
  | 'arrIata'
  | 'depScheduledUtc'
  | 'arrScheduledUtc'
  | 'depTz'
  | 'arrTz'
  | 'depTerminal'
  | 'arrTerminal'
  | 'depCity'
  | 'arrCity'
  | 'depCountry'
  | 'arrCountry'
  | 'depLat'
  | 'depLon'
  | 'arrLat'
  | 'arrLon'
  | 'distanceKm'
  | 'depGate'
  | 'arrGate'
  | 'status'
> & {
  /** Another day's flight, moved onto this date. */
  borrowed?: boolean;
};

export interface FlightDocRecord {
  id: string;
  flightId: string;
  fileName: string;
  localUri: string;
  mimeType: string;
  createdAt: number;
}

export interface PassportStats {
  totalFlights: number;
  totalHours: number;
  totalKm: number;
  visitedCountriesCount: number;
  visitedCountryCodes: string[];
  topAirportIata: string | null;
  airportVisits: Array<{ iata: string; count: number }>;
}
