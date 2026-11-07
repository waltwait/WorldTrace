/**
 * Trips as the passport shows them: each one a block of its tickets, named for where
 * it went.
 *
 * Nothing stores a trip. It is worked out from the flights every time, by the
 * countries rule (journeysOf), so a flight added later can join two trips or split
 * one. Whatever belongs to a trip, its links, is therefore kept on a flight of it.
 */

import { countryName } from './countries';
import { journeysOf, visitedOn } from './flightStats';
import type { FlightRecord } from './types';
import { utcToLocal } from './zonedTime';

export interface PassportTrip {
  /** The first flight's id: what the trip is known by while it is open. */
  key: string;
  /** In the order they were flown. */
  flights: FlightRecord[];
  /** The countries visited, connections and home left out. */
  title: string;
  /** The country for its chip, or null when no flight of it knows one. */
  code: string | null;
  /** On the departure airport's clocks, like the ticket. */
  startDate: string;
  /** The day the last flight landed, on the clocks where it landed. */
  endDate: string;
}

/**
 * The trips flown, the newest first. A year holds the trips that began in it, each
 * whole: a trip over New Year cut in two would be two trips that never happened.
 */
export function passportTrips(
  flights: readonly FlightRecord[],
  home: string | null,
  year: string | null,
): PassportTrip[] {
  return journeysOf(flights, home)
    .filter((journey) => year === null || journey[0].depDate.startsWith(year))
    .map((journey) => tripOf(journey, home))
    .reverse();
}

function tripOf(journey: FlightRecord[], home: string | null): PassportTrip {
  const first = journey[0];
  const last = journey[journey.length - 1];
  // Without a home country, home is where the trip began.
  const start = home ?? first.depCountry;
  const codes = [...visitedOn(journey)].filter((code) => code !== start);

  // A trip within the home country, or one typed in with no countries at all.
  const code = codes[0] ?? first.arrCountry ?? null;
  const title = codes.length > 0 ? codes.map(countryName).join('、') : code ? countryName(code) : first.arrIata;

  return {
    key: first.id,
    flights: journey,
    title,
    code,
    startDate: first.depDate,
    endDate: utcToLocal(last.arrScheduledUtc, last.arrTz).date,
  };
}

const DAY_MS = 24 * 3600 * 1000;

function daysFrom(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1;
}

function shortDate(date: string, withYear: boolean): string {
  const [year, month, day] = date.split('-').map(Number);
  return withYear ? `${year}/${month}/${day}` : `${month}/${day}`;
}

/**
 * 「7/1 – 7/6，6 天」. The year is said once when it is not the one chosen, and at
 * both ends of a trip across New Year. A single flight is only its day: until the
 * way back is flown, nobody knows how long the trip is.
 */
export function tripDates(trip: PassportTrip, year: string | null): string {
  const startYear = trip.startDate.slice(0, 4);
  const sayYear = year !== startYear;

  if (trip.flights.length === 1) return shortDate(trip.startDate, sayYear);

  const acrossYears = trip.endDate.slice(0, 4) !== startYear;
  const span = `${shortDate(trip.startDate, sayYear || acrossYears)} – ${shortDate(trip.endDate, acrossYears)}`;
  return `${span}，${daysFrom(trip.startDate, trip.endDate)} 天`;
}

export type RouteStep =
  | { kind: 'stop'; iata: string }
  | { kind: 'flight'; flightNumber: string }
  | { kind: 'ground' };

/** The airports in order, flown between or, in at Tokyo and out at Osaka, gone over the ground. */
export function routeChain(flights: readonly FlightRecord[]): RouteStep[] {
  const steps: RouteStep[] = [];

  flights.forEach((flight, index) => {
    const before = flights[index - 1];
    if (!before) {
      steps.push({ kind: 'stop', iata: flight.depIata });
    } else if (before.arrIata !== flight.depIata) {
      steps.push({ kind: 'ground' }, { kind: 'stop', iata: flight.depIata });
    }
    steps.push({ kind: 'flight', flightNumber: flight.flightNumber }, { kind: 'stop', iata: flight.arrIata });
  });

  return steps;
}

/**
 * Who keeps a flight's links once it is deleted: the first flight of its trip left.
 * The links were the trip's, and the trip is still there.
 */
export function linkHeir(flightId: string, trips: readonly PassportTrip[]): string | null {
  const trip = trips.find((t) => t.flights.some((f) => f.id === flightId));
  return trip?.flights.find((f) => f.id !== flightId)?.id ?? null;
}

export interface YearChoice {
  /** Null for every year. */
  year: string | null;
  label: string;
  /** Flights of the trips that began in it. */
  flights: number;
}

/**
 * What the passport can be narrowed to: every year, then each year a trip began in,
 * the newest first. A year goes by the trips, so a trip over New Year is counted, whole,
 * in the year it began, and the count beside a year is what choosing it will show.
 */
export function yearChoices(flights: readonly FlightRecord[], home: string | null): YearChoice[] {
  const trips = passportTrips(flights, home, null);
  const byYear = new Map<string, number>();
  for (const trip of trips) {
    const year = trip.startDate.slice(0, 4);
    byYear.set(year, (byYear.get(year) ?? 0) + trip.flights.length);
  }

  const all = trips.reduce((sum, trip) => sum + trip.flights.length, 0);
  const years = [...byYear]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, count]) => ({ year, label: year, flights: count }));
  return [{ year: null, label: 'ALL', flights: all }, ...years];
}
