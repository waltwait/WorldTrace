/**
 * The add-flight form, and the one step that turns it into a FlightRecord.
 *
 * It lives here rather than in AddFlightSheet so the part that decides what
 * gets saved runs under `npm test`. The sheet it replaces made up most of a
 * flight: departure always thirty days from now and 125 minutes long, gate D6,
 * terminals 2 and 1, belt 7, SkyTeam, and a form that opened on CI501 TPE→PVG
 * seat 24A. A past trip then sat in "upcoming" for a month and the passport
 * counted a route nobody flew. The same rule as the track applies: a flight
 * says only what the user typed or the ticket said, and a field nobody filled
 * stays empty. Where a value is needed and missing, the save is refused.
 */

import { findAirport } from './airports';
import type { GeminiExtractedLeg } from './geminiParser';
import { calculateFlightMiles } from './greatCircle';
import type { Alliance, CabinClass, FlightRecord } from './types';
import { isValidDate, isValidTime, localToUtc, offsetToZone, utcToLocal } from './zonedTime';

export interface FlightForm {
  flightNumber: string;
  airlineName: string;
  depIata: string;
  arrIata: string;
  /** Local date and time at the departure airport, as printed on the ticket. */
  depDate: string;
  depTime: string;
  /** Local at the arrival airport. A blank date means the departure date. */
  arrDate: string;
  arrTime: string;
  /** Only read for an airport the table does not know, e.g. "+9". */
  depUtcOffset: string;
  arrUtcOffset: string;
  seat: string;
  pnr: string;
  notes: string;
  // Read from a ticket, never typed: kept so a parse is not thrown away.
  alliance: Alliance | null;
  cabinClass: CabinClass | null;
  depTerminal: string | null;
  arrTerminal: string | null;
  depGate: string | null;
}

export const EMPTY_FLIGHT_FORM: FlightForm = Object.freeze({
  flightNumber: '',
  airlineName: '',
  depIata: '',
  arrIata: '',
  depDate: '',
  depTime: '',
  arrDate: '',
  arrTime: '',
  depUtcOffset: '',
  arrUtcOffset: '',
  seat: '',
  pnr: '',
  notes: '',
  alliance: null,
  cabinClass: null,
  depTerminal: null,
  arrTerminal: null,
  depGate: null,
});

export type BuildFlightResult =
  | { ok: true; flight: FlightRecord }
  | { ok: false; error: string };

/** The zone an airport's times are in: the table's, else the offset typed for it. */
function zoneFor(iata: string, offsetText: string): { zone: string } | { error: string } {
  const airport = findAirport(iata);
  if (airport) return { zone: airport.tz };
  if (!offsetText.trim()) {
    return { error: `找不到 ${iata} 的時區，請填當地的 UTC 偏移（例如 +9）` };
  }
  const zone = offsetToZone(offsetText);
  if (!zone) return { error: `${iata} 的 UTC 偏移只支援整點，例如 +9 或 -5` };
  return { zone };
}

const orNull = (text: string | null | undefined) => text?.trim() || null;

export function buildFlightFromForm(form: FlightForm, now: number, id: string): BuildFlightResult {
  const flightNumber = form.flightNumber.trim().toUpperCase();
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

  const depAirport = findAirport(depIata);
  const arrAirport = findAirport(arrIata);
  // Without both airports' positions there is no distance to give, and a
  // made-up one would end up in the passport's totals.
  const distanceMiles =
    depAirport && arrAirport
      ? calculateFlightMiles(
          { lat: depAirport.lat, lon: depAirport.lon },
          { lat: arrAirport.lat, lon: arrAirport.lon },
        )
      : 0;

  const airlineCode = flightNumber.slice(0, 2);

  return {
    ok: true,
    flight: {
      id,
      flightNumber,
      airlineCode,
      airlineName: form.airlineName.trim() || airlineCode,
      alliance: form.alliance,
      depIata,
      arrIata,
      depScheduledUtc,
      depEstimatedUtc: null,
      arrScheduledUtc,
      arrEstimatedUtc: null,
      depTz: dep.zone,
      arrTz: arr.zone,
      depTerminal: orNull(form.depTerminal),
      arrTerminal: orNull(form.arrTerminal),
      depGate: orNull(form.depGate),
      arrGate: null,
      baggageBelt: null,
      status: 'SCHEDULED',
      distanceMiles,
      durationMinutes: Math.round((arrScheduledUtc - depScheduledUtc) / 60000),
      seat: orNull(form.seat),
      cabinClass: form.cabinClass,
      pnr: orNull(form.pnr),
      notes: orNull(form.notes),
      notificationsEnabled: true,
      isFinished: false,
      lastSyncedAt: null,
      createdAt: now,
    },
  };
}

const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/** Minutes east of UTC, from "Z", "+08:00", "+0800" or "-05". */
function offsetMinutes(text: string): number {
  if (/^z$/i.test(text)) return 0;
  const sign = text[0] === '-' ? -1 : 1;
  const digits = text.slice(1).replace(':', '');
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || 0));
}

interface LocalFields {
  date: string;
  time: string;
  offset: string;
}

/**
 * A ticket time as the form shows it: the date and time on that airport's
 * clocks. A time with an offset is converted to the airport's zone, which is
 * also right when the model answered in UTC; one without is taken as written,
 * because tickets print local times.
 */
function localFields(iso: string | null | undefined, iata: string): LocalFields {
  const m = ISO.exec((iso ?? '').trim());
  if (!m) return { date: '', time: '', offset: '' };
  const [, date, hh, mm, zone] = m;
  if (hh === undefined) return { date, time: '', offset: '' };
  const written = { date, time: `${hh}:${mm}` };
  if (zone === undefined) return { ...written, offset: '' };

  const minutes = offsetMinutes(zone);
  const airport = findAirport(iata);
  if (airport) {
    const [y, mo, d] = date.split('-').map(Number);
    const instant = Date.UTC(y, mo - 1, d, Number(hh), Number(mm)) - minutes * 60000;
    return { ...utcToLocal(instant, airport.tz), offset: '' };
  }
  // For an airport the table lacks, the ticket's offset is the only zone there
  // is; carry it into the form when the form can hold it (whole hours).
  const offset =
    minutes % 60 === 0 ? `${minutes > 0 ? '+' : minutes < 0 ? '-' : ''}${Math.abs(minutes / 60)}` : '';
  return { ...written, offset };
}

const ALLIANCES: readonly Alliance[] = ['SkyTeam', 'Star Alliance', 'oneworld'];
const CABINS: readonly CabinClass[] = ['Economy', 'Premium Economy', 'Business', 'First'];

function oneOf<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | null {
  const wanted = value?.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === wanted) ?? null;
}

/**
 * Everything the form shows, from one parsed ticket leg. Every field is
 * replaced, including with nothing: a ticket without a seat must not inherit
 * the seat of whatever was in the form before.
 */
export function formFromLeg(leg: GeminiExtractedLeg): FlightForm {
  const depIata = (leg.depIata ?? '').trim().toUpperCase();
  const arrIata = (leg.arrIata ?? '').trim().toUpperCase();
  const dep = localFields(leg.depScheduledIso, depIata);
  const arr = localFields(leg.arrScheduledIso, arrIata);
  return {
    flightNumber: (leg.flightNumber ?? '').trim().toUpperCase(),
    airlineName: (leg.airlineName ?? '').trim(),
    depIata,
    arrIata,
    depDate: dep.date,
    depTime: dep.time,
    arrDate: arr.date,
    arrTime: arr.time,
    depUtcOffset: dep.offset,
    arrUtcOffset: arr.offset,
    seat: leg.seat?.trim() ?? '',
    pnr: leg.pnr?.trim() ?? '',
    notes: '',
    alliance: oneOf(leg.alliance, ALLIANCES),
    cabinClass: oneOf(leg.cabinClass, CABINS),
    depTerminal: orNull(leg.depTerminal),
    arrTerminal: orNull(leg.arrTerminal),
    depGate: orNull(leg.depGate),
  };
}
