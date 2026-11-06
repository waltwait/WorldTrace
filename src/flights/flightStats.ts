/**
 * Aggregates statistics for the Flight Passport.
 */

import { findAirport } from './airports';
import type { FlightRecord, PassportStats } from './types';

/**
 * A passport is a record of where you went, so it counts flights already
 * flown and nothing else — the same rule as the fog. It used to count every
 * flight unless asked not to, and its one caller never asked: a trip booked
 * for next month showed its hours, miles and a country stamp at once, under a
 * line saying stamps unlock after a completed flight.
 */
function flown(flights: FlightRecord[]): FlightRecord[] {
  return flights.filter((f) => f.isFinished);
}

export function computePassportStats(flights: FlightRecord[]): PassportStats {
  const targetFlights = flown(flights);

  if (targetFlights.length === 0) {
    return {
      totalFlights: 0,
      totalHours: 0,
      totalMiles: 0,
      visitedCountriesCount: 0,
      visitedCountryCodes: [],
      topAirportIata: null,
      airportVisits: [],
    };
  }

  let totalMinutes = 0;
  let totalMiles = 0;
  const countryCodesSet = new Set<string>();
  const airportCounts = new Map<string, number>();

  for (const flight of targetFlights) {
    totalMinutes += flight.durationMinutes;
    totalMiles += flight.distanceMiles;

    // Track origin airport & country
    const depUpper = flight.depIata.toUpperCase();
    airportCounts.set(depUpper, (airportCounts.get(depUpper) ?? 0) + 1);
    const depAirport = findAirport(depUpper);
    if (depAirport) {
      countryCodesSet.add(depAirport.countryCode);
    }

    // Track destination airport & country
    const arrUpper = flight.arrIata.toUpperCase();
    airportCounts.set(arrUpper, (airportCounts.get(arrUpper) ?? 0) + 1);
    const arrAirport = findAirport(arrUpper);
    if (arrAirport) {
      countryCodesSet.add(arrAirport.countryCode);
    }
  }

  const airportVisits = Array.from(airportCounts.entries())
    .map(([iata, count]) => ({ iata, count }))
    .sort((a, b) => b.count - a.count || a.iata.localeCompare(b.iata));

  const topAirportIata = airportVisits.length > 0 ? airportVisits[0].iata : null;
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

  return {
    totalFlights: targetFlights.length,
    totalHours,
    totalMiles: Math.round(totalMiles),
    visitedCountriesCount: countryCodesSet.size,
    visitedCountryCodes: Array.from(countryCodesSet).sort(),
    topAirportIata,
    airportVisits,
  };
}

/** The airline flown most often, by name. */
export function topAirline(flights: FlightRecord[]): { name: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const f of flown(flights)) {
    const name = f.airlineName || f.airlineCode;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of counts) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}
