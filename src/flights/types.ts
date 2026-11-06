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

export type CabinClass = 'Economy' | 'Premium Economy' | 'Business' | 'First';

export type Alliance = 'SkyTeam' | 'Star Alliance' | 'oneworld';

export interface FlightRecord {
  id: string;
  flightNumber: string; // e.g. "CI501"
  airlineCode: string; // e.g. "CI"
  airlineName: string; // e.g. "China Airlines"
  alliance?: Alliance | null;
  depIata: string; // e.g. "TPE"
  arrIata: string; // e.g. "PVG"
  depScheduledUtc: number; // Unix timestamp ms
  depEstimatedUtc?: number | null;
  arrScheduledUtc: number; // Unix timestamp ms
  arrEstimatedUtc?: number | null;
  depTz: string; // IANA timezone e.g. "Asia/Taipei"
  arrTz: string; // IANA timezone e.g. "Asia/Shanghai"
  depTerminal?: string | null;
  arrTerminal?: string | null;
  depGate?: string | null;
  arrGate?: string | null;
  baggageBelt?: string | null;
  status: FlightStatus;
  distanceMiles: number;
  durationMinutes: number;
  seat?: string | null;
  cabinClass?: CabinClass | null;
  pnr?: string | null;
  notes?: string | null;
  notificationsEnabled: boolean;
  isFinished: boolean;
  lastSyncedAt?: number | null;
  createdAt: number;
}

export interface FlightDocRecord {
  id: string;
  flightId: string;
  fileName: string;
  localUri: string;
  mimeType: string;
  createdAt: number;
}

export interface AirportInfo {
  iata: string;
  icao?: string;
  name: string;
  nameZh: string;
  city: string;
  cityZh: string;
  country: string;
  countryCode: string; // ISO 2-letter, e.g. "TW"
  flagEmoji: string; // e.g. "🇹🇼"
  lat: number;
  lon: number;
  tz: string; // IANA timezone
}

export interface TimezoneSummary {
  hasDifference: boolean;
  hourDifference: number; // arrTz offset - depTz offset in hours
  headline: string;
  description: string;
  badge: string; // e.g. "UTC+8" or "+1 hr"
}

export interface PassportStats {
  totalFlights: number;
  totalHours: number;
  totalMiles: number;
  visitedCountriesCount: number;
  visitedCountryCodes: string[];
  topAirportIata: string | null;
  airportVisits: Array<{ iata: string; count: number }>;
}
