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

/**
 * Without a home country, a stay longer than this and the next flight starts another
 * trip. With one, a trip lasts until it comes home, however long that takes.
 */
const LONGEST_STAY_MS = 30 * 24 * 3600 * 1000;
/** A stop this short or shorter, on the way somewhere else, is a connection. */
const LONGEST_CONNECTION_MS = 24 * 3600 * 1000;

const hasCountry = (code: string | null | undefined): code is string => !!code;

/** Whether this flight has brought the trip back to where it began. */
function isBackHome(
  trip: readonly FlightRecord[],
  flight: FlightRecord,
  home: string | null,
): boolean {
  if (flight.arrIata === trip[0].depIata) return true;

  // Home by any airport, TSA for TPE: the one chosen, or else where the trip began.
  // A flight within that country is not coming home from anywhere, or a trip round
  // it would end at its first stop.
  const homeCountry = home ?? trip[0].depCountry;
  return (
    hasCountry(flight.arrCountry) &&
    flight.arrCountry === homeCountry &&
    flight.depCountry !== flight.arrCountry
  );
}

type Joins = (last: FlightRecord, next: FlightRecord) => boolean;

/** Flights flown, in the order they happened, cut into trips by `joins`. */
function groupFlights(
  flights: readonly FlightRecord[],
  home: string | null,
  joins: Joins,
): FlightRecord[][] {
  const trips: FlightRecord[][] = [];

  for (const flight of [...flown(flights)].sort((a, b) => a.depScheduledUtc - b.depScheduledUtc)) {
    const trip = trips[trips.length - 1];
    const last = trip?.[trip.length - 1];
    const soonEnough =
      home !== null || (last && flight.depScheduledUtc - last.arrScheduledUtc <= LONGEST_STAY_MS);

    if (trip && last && soonEnough && !isBackHome(trip, last, home) && joins(last, flight)) {
      trip.push(flight);
    } else {
      trips.push([flight]);
    }
  }

  return trips;
}

const sameAirport: Joins = (last, next) => next.depIata === last.arrIata;

/**
 * Trips as the airports see them: a flight carries on only from the airport the last
 * one reached. In at Tokyo and out at Osaka is two flights, each with its own
 * airports: TPE 2, NRT 1, KIX 1.
 */
export function tripsOf(
  flights: readonly FlightRecord[],
  home: string | null = null,
): FlightRecord[][] {
  return groupFlights(flights, home, sameAirport);
}

/**
 * Trips as the countries see them: in at Tokyo and out at Osaka is one trip to Japan.
 * Nothing records a trip, so it is worked out: flights follow on from the airport or
 * the country the last one reached, until one comes home.
 */
export function journeysOf(
  flights: readonly FlightRecord[],
  home: string | null = null,
): FlightRecord[][] {
  return groupFlights(
    flights,
    home,
    (last, next) =>
      sameAirport(last, next) || (hasCountry(next.depCountry) && next.depCountry === last.arrCountry),
  );
}

/**
 * A stop on the way to somewhere else, a day or less. Flown back where it came from
 * instead, it was the place being visited, however short.
 */
function isConnection(arriving: FlightRecord, leaving: FlightRecord | undefined): boolean {
  return (
    leaving !== undefined &&
    leaving.depScheduledUtc - arriving.arrScheduledUtc <= LONGEST_CONNECTION_MS &&
    leaving.arrCountry !== arriving.depCountry
  );
}

/** The countries a trip visited, connections left out. */
export function visitedOn(journey: readonly FlightRecord[]): Set<string> {
  const visited = new Set<string>();
  if (hasCountry(journey[0].depCountry)) visited.add(journey[0].depCountry);

  journey.forEach((flight, index) => {
    if (hasCountry(flight.arrCountry) && !isConnection(flight, journey[index + 1])) {
      visited.add(flight.arrCountry);
    }
  });
  return visited;
}

export function computePassportStats(
  flights: FlightRecord[],
  home: string | null = null,
): PassportStats {
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
  for (const flight of targetFlights) {
    totalMinutes += flight.durationMinutes;
    totalKm += flight.distanceKm ?? 0;
  }

  const countryCodesSet = new Set(
    journeysOf(targetFlights, home).flatMap((journey) => [...visitedOn(journey)]),
  );

  // By the trip, not the flight: there and back is one visit to each airport.
  const airportCounts = new Map<string, number>();
  for (const trip of tripsOf(targetFlights, home)) {
    const used = new Set(trip.flatMap((f) => [f.depIata.toUpperCase(), f.arrIata.toUpperCase()]));
    for (const iata of used) airportCounts.set(iata, (airportCounts.get(iata) ?? 0) + 1);
  }

  // Every trip starts there, so it says nothing about where the flying has gone.
  if (home) countryCodesSet.delete(home);

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

/** The years with a flight flown in them, in order. */
export function flownYears(flights: readonly FlightRecord[]): string[] {
  const years = new Set(flown(flights).map(yearOf));
  return Array.from(years).sort();
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
  /** The trips that visited it. A connection there is not one. */
  trips: number;
  /** Every flight of those trips that left or reached the country, newest first. */
  flights: FlightRecord[];
  firstDate: string;
}

/** The countries flown to and from, the most flown first. */
export function countryStamps(
  flights: readonly FlightRecord[],
  home: string | null = null,
): CountryStamp[] {
  const byCode = new Map<string, { trips: number; flights: FlightRecord[] }>();

  for (const journey of journeysOf(flights, home)) {
    for (const code of visitedOn(journey)) {
      if (code === home) continue;
      const stamp = byCode.get(code) ?? { trips: 0, flights: [] };
      const touched = journey.filter((f) => f.depCountry === code || f.arrCountry === code);
      byCode.set(code, { trips: stamp.trips + 1, flights: [...stamp.flights, ...touched] });
    }
  }

  return Array.from(byCode, ([code, { trips, flights: touched }]) => {
    // By the date on the ticket, then by the moment, for two flights on one day.
    const newestFirst = [...touched].sort(
      (a, b) => b.depDate.localeCompare(a.depDate) || b.depScheduledUtc - a.depScheduledUtc,
    );
    return {
      code,
      trips,
      flights: newestFirst,
      firstDate: newestFirst[newestFirst.length - 1].depDate,
    };
  }).sort(
    mostFirst(
      (stamp) => stamp.trips,
      (stamp) => stamp.code,
    ),
  );
}

/** Every country a flight touches, the most first, whether flown yet or not. */
export function knownCountries(flights: readonly FlightRecord[]): string[] {
  const counts = new Map<string, number>();

  for (const flight of flights) {
    for (const code of new Set([flight.depCountry, flight.arrCountry])) {
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }

  return Array.from(counts, ([code, count]) => ({ code, count }))
    .sort(
      mostFirst(
        (country) => country.count,
        (country) => country.code,
      ),
    )
    .map((country) => country.code);
}

/**
 * The airlines flown, the most flown first. An airline is its code: the same one is
 * EVA Air looked up, BR when the API gave no name, and whatever was typed by hand,
 * and counted by name it was three airlines. It is called by the name its flights
 * used most, a real name before the bare code.
 */
export function rankAirlines(flights: readonly FlightRecord[]): Array<{ name: string; count: number }> {
  const byCode = new Map<string, { count: number; names: Map<string, number> }>();
  for (const f of flown(flights)) {
    const airline = byCode.get(f.airlineCode) ?? { count: 0, names: new Map<string, number>() };
    airline.count += 1;
    const name = f.airlineName || f.airlineCode;
    airline.names.set(name, (airline.names.get(name) ?? 0) + 1);
    byCode.set(f.airlineCode, airline);
  }

  const nameOf = (code: string, names: Map<string, number>): string => {
    const [best] = [...names]
      .filter(([name]) => name !== code)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
    return best?.[0] ?? code;
  };

  return Array.from(byCode, ([code, { count, names }]) => ({ name: nameOf(code, names), count })).sort(
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
