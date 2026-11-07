/**
 * The add-flight form, and the one step that turns it into a FlightRecord.
 *
 * It lives here rather than in AddFlightSheet so the part that decides what gets
 * saved runs under `npm test`. A flight number and a date are all that has to be
 * given: the status API answers the rest, and the seat and notes are the user's
 * own. Only when it finds nothing does the sheet ask for the airports and times
 * by hand.
 *
 * The same rule as the track applies: a flight says only what the user typed or
 * the API said, and a field nobody filled stays empty. An earlier sheet made up
 * most of a flight (departure thirty days out, gate D6, TPE→PVG), so a past trip
 * sat in "upcoming" for a month and the passport counted a route nobody flew.
 */

import type { TicketFacts } from './ticketFacts';
import type { FlightRecord, LookedUpFlight } from './types';
import { isValidDate, isValidTime, localToUtc, offsetToZone, utcToLocal } from './zonedTime';

export interface FlightForm {
  flightNumber: string;
  /** Local date and time at the departure airport, as printed on the ticket. */
  depDate: string;
  depTime: string;
  seat: string;
  notes: string;
  /** What the API said for this number on this date, if it was asked. */
  lookedUp: LookedUpFlight | null;
  // Typed by hand, only when nothing could be looked up.
  airlineName: string;
  depIata: string;
  arrIata: string;
  /** Local at the arrival airport. A blank date means the departure date. */
  arrDate: string;
  arrTime: string;
  /** With no table of airports, the only way to read a typed time, e.g. "+9". */
  depUtcOffset: string;
  arrUtcOffset: string;
}

export const EMPTY_FLIGHT_FORM: FlightForm = Object.freeze({
  flightNumber: '',
  depDate: '',
  depTime: '',
  seat: '',
  notes: '',
  lookedUp: null,
  airlineName: '',
  depIata: '',
  arrIata: '',
  arrDate: '',
  arrTime: '',
  depUtcOffset: '',
  arrUtcOffset: '',
});

export type BuildFlightResult =
  | { ok: true; flight: FlightRecord }
  | { ok: false; error: string };

const orNull = (text: string | null | undefined) => text?.trim() || null;

/** Tickets print "JX 871"; the status lookup and the airline code need JX871. */
export const cleanFlightNumber = (text: string) => text.replace(/\s+/g, '').toUpperCase();

/** A flight that is over when it is saved is the user's word that it was flown. */
function outcome(status: FlightRecord['status'], arrScheduledUtc: number, now: number) {
  if (status === 'CANCELLED') return { status, isFinished: false };
  const over = arrScheduledUtc <= now;
  return { status: over ? ('LANDED' as const) : status, isFinished: over };
}

function fromLookup(
  form: FlightForm,
  flight: LookedUpFlight,
  now: number,
  id: string,
): FlightRecord {
  const departure = utcToLocal(flight.depScheduledUtc, flight.depTz);

  return {
    ...flight,
    ...outcome(flight.status, flight.arrScheduledUtc, now),
    id,
    depDate: departure.date,
    depTime: departure.time,
    seat: orNull(form.seat),
    notes: orNull(form.notes),
    createdAt: now,
    scheduleSource: 'api',
    durationMinutes: Math.round((flight.arrScheduledUtc - flight.depScheduledUtc) / 60000),
    depEstimatedUtc: null,
    arrEstimatedUtc: null,
    baggageBelt: null,
    lastSyncedAt: null,
  };
}

/** The zone a typed time is in, from the offset typed for it. */
function zoneFor(iata: string, offsetText: string): { zone: string } | { error: string } {
  if (!offsetText.trim()) return { error: `請填 ${iata} 的 UTC 偏移，例如 +9` };
  const zone = offsetToZone(offsetText);
  if (!zone) return { error: `${iata} 的 UTC 偏移只支援整點，例如 +9 或 -5` };
  return { zone };
}

function fromTyped(form: FlightForm, now: number, id: string): BuildFlightResult {
  const flightNumber = cleanFlightNumber(form.flightNumber);
  const depIata = form.depIata.trim().toUpperCase();
  const arrIata = form.arrIata.trim().toUpperCase();

  if (!flightNumber) return { ok: false, error: '請填寫航班編號' };
  if (!/^[A-Z]{3}$/.test(depIata) || !/^[A-Z]{3}$/.test(arrIata)) {
    return { ok: false, error: '起降機場請填 3 碼 IATA 代碼，例如 TPE' };
  }

  const dep = zoneFor(depIata, form.depUtcOffset);
  if ('error' in dep) return { ok: false, error: dep.error };
  const arr = zoneFor(arrIata, form.arrUtcOffset);
  if ('error' in arr) return { ok: false, error: arr.error };

  if (!isValidDate(form.depDate)) {
    return { ok: false, error: '請填寫正確的起飛日期，例如 2026-12-01' };
  }
  if (!isValidTime(form.depTime)) {
    return { ok: false, error: '請填寫起飛時間（起飛機場當地時間），例如 07:30' };
  }
  const arrDate = form.arrDate.trim() || form.depDate;
  if (!isValidDate(arrDate)) return { ok: false, error: '抵達日期不正確，例如 2026-12-02' };
  if (!isValidTime(form.arrTime)) {
    return { ok: false, error: '請填寫抵達時間（抵達機場當地時間），例如 11:45' };
  }

  // Both only fail on input the checks above already refused.
  const depScheduledUtc = localToUtc(form.depDate, form.depTime, dep.zone) as number;
  const arrScheduledUtc = localToUtc(arrDate, form.arrTime, arr.zone) as number;
  if (arrScheduledUtc <= depScheduledUtc) {
    return { ok: false, error: '抵達時間早於起飛時間：跨日航班請填抵達日期' };
  }

  const airlineCode = flightNumber.slice(0, 2);
  const departure = utcToLocal(depScheduledUtc, dep.zone);

  return {
    ok: true,
    flight: {
      id,
      flightNumber,
      depDate: departure.date,
      depTime: departure.time,
      seat: orNull(form.seat),
      notes: orNull(form.notes),
      createdAt: now,
      scheduleSource: 'user',
      airlineCode,
      airlineName: form.airlineName.trim() || airlineCode,
      depIata,
      arrIata,
      depScheduledUtc,
      arrScheduledUtc,
      depTz: dep.zone,
      arrTz: arr.zone,
      depTerminal: null,
      arrTerminal: null,
      // Nothing said where these airports are, and a made-up position would end
      // up on the map and in the passport's totals.
      depCity: null,
      arrCity: null,
      depCountry: null,
      arrCountry: null,
      depLat: null,
      depLon: null,
      arrLat: null,
      arrLon: null,
      distanceKm: null,
      durationMinutes: Math.round((arrScheduledUtc - depScheduledUtc) / 60000),
      ...outcome('SCHEDULED', arrScheduledUtc, now),
      depEstimatedUtc: null,
      arrEstimatedUtc: null,
      depGate: null,
      arrGate: null,
      baggageBelt: null,
      lastSyncedAt: null,
    },
  };
}

export function buildFlightFromForm(form: FlightForm, now: number, id: string): BuildFlightResult {
  return form.lookedUp
    ? { ok: true, flight: fromLookup(form, form.lookedUp, now, id) }
    : fromTyped(form, now, id);
}

/** A lookup answers for one number on one date; changing either drops it. */
export function editForm<K extends keyof FlightForm>(
  form: FlightForm,
  key: K,
  value: FlightForm[K],
): FlightForm {
  const lookedUp = key === 'flightNumber' || key === 'depDate' ? null : form.lookedUp;
  return { ...form, lookedUp, [key]: value };
}

/** A number can fly several legs in a day: the ticket's time says which is ours. */
function pickLeg(
  legs: readonly LookedUpFlight[],
  time: string | null,
): LookedUpFlight | undefined {
  const atThatTime = legs.find((leg) => utcToLocal(leg.depScheduledUtc, leg.depTz).time === time);
  return atThatTime ?? legs[0];
}

/**
 * The form for a ticket: the lookup, and the seat only the ticket knows. With
 * nothing found it keeps `base`, so a failed lookup does not clear what the user
 * typed, and fills in what the ticket gave.
 */
export function formFromTicket(
  ticket: TicketFacts,
  legs: readonly LookedUpFlight[],
  base: FlightForm,
): FlightForm {
  const leg = pickLeg(legs, ticket.time);
  const seat = ticket.seat ?? base.seat;

  if (leg) {
    const departure = utcToLocal(leg.depScheduledUtc, leg.depTz);
    return {
      ...base,
      flightNumber: leg.flightNumber,
      depDate: departure.date,
      depTime: departure.time,
      seat,
      lookedUp: leg,
    };
  }

  return {
    ...base,
    flightNumber: ticket.flightNumber,
    depDate: ticket.date ?? base.depDate,
    depTime: ticket.time ?? base.depTime,
    seat,
    lookedUp: null,
  };
}

/** What the button says after reading. More than one flight must not pass unmentioned. */
export function legsFoundMessage(legs: ReadonlyArray<{ flightNumber: string }>): string {
  return legs.length > 1 ? `已辨識 ${legs.length} 段航班` : `已辨識 ${legs[0].flightNumber}`;
}
