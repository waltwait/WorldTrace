/**
 * Aggregates statistics for the Flight Passport.
 */

import type { FlightRecord, PassportStats } from './types';

/**
 * A passport is a record of where you went, so it counts flights already
 * flown and nothing else — the same rule as the fog. It used to count every
 * flight unless asked not to, and its one caller never asked: a trip booked
 * for next month showed its hours, miles and a country stamp at once, under a
 * line saying stamps unlock after a completed flight.
 */
function flown(flights: readonly FlightRecord[]): FlightRecord[] {
  return flights.filter((f) => f.isFinished && f.status !== 'CANCELLED');
}

export function computePassportStats(flights: FlightRecord[]): PassportStats {
  const targetFlights = flown(flights);

  if (targetFlights.length === 0) {
    return {
      totalFlights: 0,
      totalHours: 0,
      totalKm: 0,
      visitedCountriesCount: 0,
      visitedCountryCodes: [],
      topAirportIata: null,
      airportVisits: [],
    };
  }

  let totalMinutes = 0;
  let totalKm = 0;
  const countryCodesSet = new Set<string>();
  const airportCounts = new Map<string, number>();

  for (const flight of targetFlights) {
    totalMinutes += flight.durationMinutes;
    totalKm += flight.distanceKm ?? 0;

    // Track origin airport & country
    const depUpper = flight.depIata.toUpperCase();
    airportCounts.set(depUpper, (airportCounts.get(depUpper) ?? 0) + 1);
    if (flight.depCountry) countryCodesSet.add(flight.depCountry);

    // Track destination airport & country
    const arrUpper = flight.arrIata.toUpperCase();
    airportCounts.set(arrUpper, (airportCounts.get(arrUpper) ?? 0) + 1);
    if (flight.arrCountry) countryCodesSet.add(flight.arrCountry);
  }

  const airportVisits = Array.from(airportCounts.entries())
    .map(([iata, count]) => ({ iata, count }))
    .sort((a, b) => b.count - a.count || a.iata.localeCompare(b.iata));

  const topAirportIata = airportVisits.length > 0 ? airportVisits[0].iata : null;
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

  return {
    totalFlights: targetFlights.length,
    totalHours,
    totalKm: Math.round(totalKm),
    visitedCountriesCount: countryCodesSet.size,
    visitedCountryCodes: Array.from(countryCodesSet).sort(),
    topAirportIata,
    airportVisits,
  };
}

/** Ties go by name, so a list keeps its order from one look to the next. */
function mostFirst<T>(count: (item: T) => number, name: (item: T) => string) {
  return (a: T, b: T) => count(b) - count(a) || name(a).localeCompare(name(b));
}

/** The years with a flight flown in them, newest first. */
export function flownYears(flights: readonly FlightRecord[]): string[] {
  const years = new Set(flown(flights).map(yearOf));
  return Array.from(years).sort((a, b) => b.localeCompare(a));
}

// The departure date is on the airport's clocks, the same as the ticket. UTC
// would put a New Year's morning flight from Taipei in the year before.
function yearOf(flight: FlightRecord): string {
  return flight.depDate.slice(0, 4);
}

export function flightsInYear(flights: FlightRecord[], year: string | null): FlightRecord[] {
  return year === null ? flights : flights.filter((f) => yearOf(f) === year);
}

export interface CountryStamp {
  code: string;
  /** Every flight flown that left or reached the country, newest first. */
  flights: FlightRecord[];
  firstDate: string;
}

/** The countries flown to and from, the most flown first. */
export function countryStamps(flights: readonly FlightRecord[]): CountryStamp[] {
  const byCode = new Map<string, FlightRecord[]>();

  for (const flight of flown(flights)) {
    // A Set, so a domestic flight is one flight rather than two.
    for (const code of new Set([flight.depCountry, flight.arrCountry])) {
      if (!code) continue;
      byCode.set(code, [...(byCode.get(code) ?? []), flight]);
    }
  }

  return Array.from(byCode, ([code, touched]) => {
    const newestFirst = [...touched].sort((a, b) => b.depDate.localeCompare(a.depDate));
    return { code, flights: newestFirst, firstDate: newestFirst[newestFirst.length - 1].depDate };
  }).sort(
    mostFirst(
      (stamp) => stamp.flights.length,
      (stamp) => stamp.code,
    ),
  );
}

/** The airlines flown, the most flown first. */
export function rankAirlines(flights: readonly FlightRecord[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const f of flown(flights)) {
    const name = f.airlineName || f.airlineCode;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    mostFirst(
      (airline) => airline.count,
      (airline) => airline.name,
    ),
  );
}

/** The routes flown, the most flown first. There and back is one route. */
export function rankRoutes(
  flights: readonly FlightRecord[],
): Array<{ from: string; to: string; count: number }> {
  const counts = new Map<string, { from: string; to: string; count: number }>();

  for (const f of flown(flights)) {
    const [from, to] = [f.depIata, f.arrIata].sort();
    const key = `${from}-${to}`;
    const route = counts.get(key) ?? { from, to, count: 0 };
    counts.set(key, { ...route, count: route.count + 1 });
  }

  return Array.from(counts.values()).sort(
    mostFirst(
      (route) => route.count,
      (route) => route.from + route.to,
    ),
  );
}

/** The flight that went furthest. A distance nobody knows cannot be the furthest. */
export function longestFlight(flights: readonly FlightRecord[]): FlightRecord | null {
  let best: FlightRecord | null = null;
  for (const f of flown(flights)) {
    if (f.distanceKm == null) continue;
    if (best === null || f.distanceKm > (best.distanceKm ?? 0)) best = f;
  }
  return best;
}

/** The city of an airport, from a flight that used it: there is no table of airports. */
export function airportCity(flights: readonly FlightRecord[], iata: string): string | null {
  for (const f of flights) {
    if (f.depIata === iata && f.depCity) return f.depCity;
    if (f.arrIata === iata && f.arrCity) return f.arrCity;
  }
  return null;
}

const EQUATOR_KM = 40_075;

export function timesAroundEarth(km: number): number {
  return km / EQUATOR_KM;
}
