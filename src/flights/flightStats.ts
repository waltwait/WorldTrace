/**
 * Aggregates statistics for the Flight Passport.
 */

import { findAirport } from './airports';
import type { FlightRecord, PassportStats } from './types';

export function computePassportStats(
  flights: FlightRecord[],
  options?: { finishedOnly?: boolean },
): PassportStats {
  const targetFlights = options?.finishedOnly
    ? flights.filter((f) => f.isFinished)
    : flights;

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
