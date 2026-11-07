/**
 * Pure view-models for the two shareable PNG cards:
 * - Trip card (旅程圖): a single trip with its visited flags, spherical flight arcs,
 *   route chain, and seat-free tickets.
 * - Year / All passport card (年度圖): visited flags, spherical flight arcs, totals
 *   (flights, hours, km), and one summary row per trip. No laps of the Earth: the user
 *   took them out of the passport.
 *
 * Monthly cards are deliberately absent so cross-month and cross-year trips are
 * never sliced in half.
 */

import { flagRow } from '../ui/flagRow';
import { formatWholeKm } from '../ui/format';
import { flagEmoji } from './countries';
import type { TicketView } from './flightDisplay';
import { computePassportStats, countryStamps, visitedOn } from './flightStats';
import { passportTrips, routeChain, tripDates, type PassportTrip, type RouteStep } from './trips';
import type { FlightRecord } from './types';
import { utcToLocal } from './zonedTime';

export type CardAspect = '9:16' | '4:5';

export interface CardSize {
  logicalWidth: number;
  logicalHeight: number;
  pixelWidth: number;
  pixelHeight: number;
}

export const CARD_DIMENSIONS: Record<CardAspect, CardSize> = {
  '9:16': { logicalWidth: 360, logicalHeight: 640, pixelWidth: 1080, pixelHeight: 1920 },
  '4:5': { logicalWidth: 360, logicalHeight: 450, pixelWidth: 1080, pixelHeight: 1350 },
};

export interface ShareTicketItem extends TicketView {
  id: string;
  heading: string;
}

export interface TripShareModel {
  aspect: CardAspect;
  flags: string[];
  title: string;
  dates: string;
  badge: string;
  flights: FlightRecord[];
  steps: RouteStep[];
  compactTickets: boolean;
  tickets: ShareTicketItem[];
  overflowCount: number;
  fileName: string;
}

export interface YearTripRow {
  flag: string;
  title: string;
  route: string;
  dates: string;
}

export interface YearShareModel {
  aspect: CardAspect;
  periodLabel: string;
  flags: string[];
  moreFlags: number;
  flights: FlightRecord[];
  totalFlights: number;
  totalHours: string;
  totalKmLabel: string;
  tripCount: number;
  rows: YearTripRow[];
  overflowTrips: number;
  fileName: string;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * A flight formatted for a shared card: no seat on the stub (flight number takes
 * its place), and both local departure and arrival times on the left.
 */
export function shareTicketFor(flight: FlightRecord): ShareTicketItem {
  const dep = utcToLocal(flight.depScheduledUtc, flight.depTz);
  const arr = utcToLocal(flight.arrScheduledUtc, flight.arrTz);
  const [, month, day] = dep.date.split('-').map(Number);
  const dayDiff = Math.round((Date.parse(arr.date) - Date.parse(dep.date)) / DAY_MS);
  const suffix = dayDiff > 0 ? ` +${dayDiff}` : dayDiff < 0 ? ` ${dayDiff}` : '';

  return {
    id: flight.id,
    from: flight.depIata,
    to: flight.arrIata,
    when: `${month} 月 ${day} 日 ${dep.time} – ${arr.time}${suffix}`,
    stubLabel: '',
    stubValue: flight.flightNumber,
    past: true,
    heading: flight.airlineName || flight.airlineCode || flight.flightNumber,
  };
}

function tripVisitedFlags(trip: PassportTrip, home: string | null): string[] {
  const start = home ?? trip.flights[0]?.depCountry ?? null;
  const codes = [...visitedOn(trip.flights)].filter((code) => code !== start);
  if (codes.length > 0) {
    return codes.map(flagEmoji).filter(Boolean);
  }
  return trip.code ? [flagEmoji(trip.code)].filter(Boolean) : [];
}

function compactRouteText(flights: readonly FlightRecord[]): string {
  const chains: string[][] = [];
  for (const flight of flights) {
    const current = chains[chains.length - 1];
    if (!current) {
      chains.push([flight.depIata, flight.arrIata]);
    } else if (current[current.length - 1] === flight.depIata) {
      current.push(flight.arrIata);
    } else {
      chains.push([flight.depIata, flight.arrIata]);
    }
  }
  return chains.map((stops) => stops.join(' → ')).join(' · ');
}

export function buildTripShareModel(
  trip: PassportTrip,
  aspect: CardAspect,
  home: string | null,
): TripShareModel {
  const allTickets = trip.flights.map(shareTicketFor);
  const isTall = aspect === '9:16';

  let compactTickets: boolean;
  let maxShown: number;
  if (isTall) {
    if (allTickets.length <= 2) {
      compactTickets = false;
      maxShown = 2;
    } else {
      compactTickets = true;
      maxShown = allTickets.length <= 4 ? 4 : 3;
    }
  } else {
    compactTickets = true;
    maxShown = allTickets.length <= 3 ? 3 : 2;
  }

  const tickets = allTickets.slice(0, maxShown);
  const overflowCount = Math.max(0, allTickets.length - tickets.length);

  const knownDistances = trip.flights
    .map((f) => f.distanceKm)
    .filter((km): km is number => km != null);
  const totalKm = knownDistances.reduce((sum, km) => sum + km, 0);
  const badge =
    knownDistances.length > 0
      ? `${trip.flights.length} 班 · ${formatWholeKm(totalKm)}`
      : `${trip.flights.length} 班`;

  return {
    aspect,
    flags: tripVisitedFlags(trip, home),
    title: trip.title,
    dates: tripDates(trip, null),
    badge,
    flights: trip.flights,
    steps: routeChain(trip.flights),
    compactTickets,
    tickets,
    overflowCount,
    fileName: `worldtrace-trip-${trip.startDate}-${aspect.replace(':', 'x')}.png`,
  };
}

export function buildYearShareModel(
  flights: readonly FlightRecord[],
  home: string | null,
  year: string | null,
  aspect: CardAspect,
): YearShareModel {
  const trips = passportTrips(flights, home, year);
  // Keep cross-New-Year trips whole in the year they began so totals and trip rows agree.
  const targetFlights = year === null ? [...flights] : trips.flatMap((t) => t.flights);
  const stats = computePassportStats(targetFlights, home);
  const stamps = countryStamps(targetFlights, home);

  const isTall = aspect === '9:16';
  const flagSlice = flagRow(
    stamps.map((s) => s.code),
    isTall ? 9 : 5,
  );

  const allRows: YearTripRow[] = trips.map((trip) => ({
    flag: trip.code ? flagEmoji(trip.code) : '✈️',
    title: trip.title,
    route: compactRouteText(trip.flights),
    dates: tripDates(trip, year),
  }));

  const rowCap = isTall
    ? allRows.length <= 6
      ? 6
      : 5
    : allRows.length <= 4
      ? 4
      : 3;
  const rows = allRows.slice(0, rowCap);
  const overflowTrips = Math.max(0, allRows.length - rows.length);

  return {
    aspect,
    periodLabel: year ?? 'ALL',
    flags: flagSlice.codes.map(flagEmoji).filter(Boolean),
    moreFlags: flagSlice.more,
    flights: targetFlights,
    totalFlights: stats.totalFlights,
    totalHours: `${stats.totalHours}`,
    totalKmLabel: formatWholeKm(stats.totalKm),
    tripCount: trips.length,
    rows,
    overflowTrips,
    fileName: `worldtrace-passport-${year ?? 'all'}-${aspect.replace(':', 'x')}.png`,
  };
}
