import { describe, expect, test } from 'vitest';
import {
  buildFlightFromForm,
  EMPTY_FLIGHT_FORM,
  formFromLeg,
  type FlightForm,
} from './flightForm';
import type { GeminiExtractedLeg } from './geminiParser';

const NOW = Date.UTC(2026, 10, 6, 2, 0);
const ID = 'fl_test';

function form(fields: Partial<FlightForm>): FlightForm {
  return { ...EMPTY_FLIGHT_FORM, ...fields };
}

const tpeNrt = form({
  flightNumber: 'br198',
  depIata: 'tpe',
  arrIata: 'NRT',
  depDate: '2026-12-01',
  depTime: '07:30',
  arrTime: '11:45',
});

function built(f: FlightForm) {
  const result = buildFlightFromForm(f, NOW, ID);
  if (!result.ok) throw new Error(`expected a flight, got: ${result.error}`);
  return result.flight;
}

function refusal(f: FlightForm): string {
  const result = buildFlightFromForm(f, NOW, ID);
  if (result.ok) throw new Error('expected a refusal, got a flight');
  return result.error;
}

describe('the empty form', () => {
  test('starts with nothing filled in, so nothing unseen reaches a saved flight', () => {
    for (const value of Object.values(EMPTY_FLIGHT_FORM)) {
      expect(value === '' || value === null).toBe(true);
    }
  });
});

describe('buildFlightFromForm', () => {
  test('reads each time on the clocks of its own airport', () => {
    const flight = built(tpeNrt);
    expect(flight.depScheduledUtc).toBe(Date.UTC(2026, 10, 30, 23, 30));
    expect(flight.arrScheduledUtc).toBe(Date.UTC(2026, 11, 1, 2, 45));
    expect(flight.durationMinutes).toBe(195);
    expect(flight.depTz).toBe('Asia/Taipei');
    expect(flight.arrTz).toBe('Asia/Tokyo');
    expect(flight.flightNumber).toBe('BR198');
    expect(flight.depIata).toBe('TPE');
  });

  test('refuses to save without a departure date and time, rather than making one up', () => {
    expect(refusal({ ...tpeNrt, depDate: '' })).toContain('起飛日期');
    expect(refusal({ ...tpeNrt, depTime: '' })).toContain('起飛');
    expect(refusal({ ...tpeNrt, depDate: '2026-02-30' })).toContain('起飛日期');
    expect(refusal({ ...tpeNrt, arrTime: '' })).toContain('抵達');
  });

  test('a blank arrival date is the departure date, and a flight cannot land before it leaves', () => {
    // Over the date line the same calendar date is many hours later: fine.
    const tpeLax = built(
      form({
        flightNumber: 'BR12',
        depIata: 'TPE',
        arrIata: 'LAX',
        depDate: '2026-12-01',
        depTime: '23:40',
        arrTime: '19:30',
      }),
    );
    expect(tpeLax.durationMinutes).toBe(11 * 60 + 50);

    // Overnight to Europe it is not: the form has to be told the next day.
    const overnight = form({
      flightNumber: 'CI61',
      depIata: 'TPE',
      arrIata: 'FRA',
      depDate: '2026-12-01',
      depTime: '23:20',
      arrTime: '06:40',
    });
    expect(refusal(overnight)).toContain('抵達日期');
    expect(built({ ...overnight, arrDate: '2026-12-02' }).durationMinutes).toBe(14 * 60 + 20);
  });

  test('saves only what it was told: no gate, terminal, belt, seat, alliance or cabin of its own', () => {
    const flight = built(tpeNrt);
    expect(flight.alliance).toBeNull();
    expect(flight.cabinClass).toBeNull();
    expect(flight.depTerminal).toBeNull();
    expect(flight.arrTerminal).toBeNull();
    expect(flight.depGate).toBeNull();
    expect(flight.arrGate).toBeNull();
    expect(flight.baggageBelt).toBeNull();
    expect(flight.seat).toBeNull();
    expect(flight.pnr).toBeNull();
    expect(flight.notes).toBeNull();
    expect(flight.airlineName).toBe('BR');
  });

  test('has never been synced, so the first refresh asks for its status', () => {
    const flight = built(tpeNrt);
    expect(flight.lastSyncedAt).toBeNull();
    expect(flight.createdAt).toBe(NOW);
    expect(flight.id).toBe(ID);
    expect(flight.status).toBe('SCHEDULED');
    expect(flight.isFinished).toBe(false);
  });

  test('an airport the table does not know needs its UTC offset typed in', () => {
    const toUnknown = { ...tpeNrt, arrIata: 'ZZZ' };
    expect(refusal(toUnknown)).toContain('ZZZ');
    expect(refusal({ ...toUnknown, arrUtcOffset: '+5:30' })).toContain('整點');

    const flight = built({ ...toUnknown, arrUtcOffset: '+9' });
    expect(flight.arrTz).toBe('Etc/GMT-9');
    expect(flight.arrScheduledUtc).toBe(Date.UTC(2026, 11, 1, 2, 45));
  });

  test('refuses an incomplete flight number or airport code', () => {
    expect(refusal({ ...tpeNrt, flightNumber: '  ' })).toContain('航班編號');
    expect(refusal({ ...tpeNrt, depIata: 'TP' })).toContain('IATA');
  });
});

describe('formFromLeg', () => {
  const leg: GeminiExtractedLeg = {
    airlineCode: 'CI',
    airlineName: 'China Airlines',
    alliance: 'SkyTeam',
    flightNumber: 'CI501',
    depIata: 'TPE',
    arrIata: 'PVG',
    depScheduledIso: '2026-12-31T08:45:00+08:00',
    arrScheduledIso: '2026-12-31T10:50:00+08:00',
    depTerminal: '2',
    arrTerminal: '1',
    depGate: 'D6',
    seat: '24A',
    pnr: '7X9K2M',
    cabinClass: 'Economy',
  };

  test('fills every field from the ticket and keeps what it said about gates and cabin', () => {
    const flight = built(formFromLeg(leg));
    expect(flight.depScheduledUtc).toBe(Date.UTC(2026, 11, 31, 0, 45));
    expect(flight.arrScheduledUtc).toBe(Date.UTC(2026, 11, 31, 2, 50));
    expect(flight.airlineName).toBe('China Airlines');
    expect(flight.alliance).toBe('SkyTeam');
    expect(flight.cabinClass).toBe('Economy');
    expect(flight.depTerminal).toBe('2');
    expect(flight.arrTerminal).toBe('1');
    expect(flight.depGate).toBe('D6');
    expect(flight.seat).toBe('24A');
    expect(flight.pnr).toBe('7X9K2M');
  });

  test('a ticket that says nothing about a field leaves it empty, whatever was there before', () => {
    const f = formFromLeg({ ...leg, seat: null, pnr: null, depGate: null, alliance: null });
    expect(f.seat).toBe('');
    expect(f.pnr).toBe('');
    expect(f.depGate).toBeNull();
    expect(f.alliance).toBeNull();
  });

  test('shows a UTC time as the time at the airport', () => {
    const f = formFromLeg({ ...leg, depScheduledIso: '2026-12-31T00:45:00Z' });
    expect([f.depDate, f.depTime]).toEqual(['2026-12-31', '08:45']);
  });

  test('takes a time with no offset as written, since tickets print local times', () => {
    const f = formFromLeg({ ...leg, depScheduledIso: '2026-12-31T08:45:00' });
    expect([f.depDate, f.depTime]).toEqual(['2026-12-31', '08:45']);
  });

  test('a date with no time fills the date and leaves the time to the user', () => {
    const f = formFromLeg({ ...leg, depScheduledIso: '2026-12-31', arrScheduledIso: '' });
    expect([f.depDate, f.depTime, f.arrDate, f.arrTime]).toEqual(['2026-12-31', '', '', '']);
  });

  test('an airport the table does not know keeps the offset the ticket gave', () => {
    const f = formFromLeg({ ...leg, arrIata: 'ZZZ', arrScheduledIso: '2026-12-31T13:50:00+09:00' });
    expect([f.arrDate, f.arrTime, f.arrUtcOffset]).toEqual(['2026-12-31', '13:50', '+9']);
  });

  test('drops an alliance or cabin it does not recognise rather than storing it', () => {
    const f = formFromLeg({ ...leg, alliance: 'Skyteam Alliance', cabinClass: 'business' });
    expect(f.alliance).toBeNull();
    expect(f.cabinClass).toBe('Business');
  });
});
