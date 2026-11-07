import { describe, expect, test } from 'vitest';
import {
  buildFlightFromForm,
  editForm,
  EMPTY_FLIGHT_FORM,
  formFromTicket,
  legsFoundMessage,
  type FlightForm,
} from './flightForm';
import type { TicketFacts } from './ticketFacts';
import type { LookedUpFlight } from './types';

const NOW = Date.UTC(2026, 10, 6, 2, 0);
const ID = 'fl_test';

function form(fields: Partial<FlightForm>): FlightForm {
  return { ...EMPTY_FLIGHT_FORM, ...fields };
}

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

const oka: LookedUpFlight = {
  flightNumber: 'JX871',
  airlineCode: 'JX',
  airlineName: 'Starlux Airlines',
  depIata: 'OKA',
  arrIata: 'TPE',
  depScheduledUtc: Date.UTC(2027, 2, 3, 6, 25),
  arrScheduledUtc: Date.UTC(2027, 2, 3, 8, 10),
  depTz: 'Asia/Tokyo',
  arrTz: 'Asia/Taipei',
  depTerminal: 'I',
  arrTerminal: '1',
  depCity: 'Naha',
  arrCity: 'Taipei',
  depCountry: 'JP',
  arrCountry: 'TW',
  depLat: 26.2,
  depLon: 127.65,
  arrLat: 25.08,
  arrLon: 121.23,
  distanceKm: 640.5,
  depGate: '5',
  arrGate: null,
  status: 'SCHEDULED',
};

const ticket: TicketFacts = {
  flightNumber: 'JX871',
  date: '2027-03-03',
  time: '15:25',
  seat: '12A',
  yearGuessed: false,
};

describe('the empty form', () => {
  test('starts with nothing filled in, so nothing unseen reaches a saved flight', () => {
    for (const value of Object.values(EMPTY_FLIGHT_FORM)) {
      expect(value === '' || value === null).toBe(true);
    }
  });

  test('has no place for a booking code', () => {
    expect(Object.keys(EMPTY_FLIGHT_FORM)).not.toContain('pnr');
  });
});

describe('a flight that was looked up', () => {
  const looked = form({ flightNumber: 'JX871', depDate: '2027-03-03', seat: '12A', lookedUp: oka });

  test('says it came from the API, and takes the timetable from it', () => {
    const flight = built(looked);

    expect(flight.scheduleSource).toBe('api');
    expect([flight.depIata, flight.arrIata, flight.airlineName]).toEqual([
      'OKA',
      'TPE',
      'Starlux Airlines',
    ]);
    expect(flight.depScheduledUtc).toBe(Date.UTC(2027, 2, 3, 6, 25));
  });

  test('carries what the airports are, for the passport and the map', () => {
    const flight = built(looked);

    expect([flight.depCountry, flight.arrCountry]).toEqual(['JP', 'TW']);
    expect([flight.depCity, flight.depLat, flight.depLon]).toEqual(['Naha', 26.2, 127.65]);
    expect(flight.distanceKm).toBe(640.5);
  });

  test('keeps what the user gave', () => {
    const flight = built({ ...looked, notes: '靠窗' });

    expect([flight.seat, flight.notes]).toEqual(['12A', '靠窗']);
  });

  test('takes its date and time from the departure airport\'s clocks', () => {
    const flight = built(looked);

    expect([flight.depDate, flight.depTime]).toEqual(['2027-03-03', '15:25']);
  });

  test('works out the duration, with the clocks an hour apart', () => {
    // The mail this flight came from says 01h 45m.
    expect(built(looked).durationMinutes).toBe(105);
  });

  test('starts with the gate and status the API gave', () => {
    const flight = built({ ...looked, lookedUp: { ...oka, status: 'DELAYED' } });

    expect([flight.depGate, flight.status]).toEqual(['5', 'DELAYED']);
  });

  test('needs nothing else typed', () => {
    expect(() => built(form({ lookedUp: oka }))).not.toThrow();
  });
});

describe('a flight typed in by hand, when nothing could be looked up', () => {
  const typed = form({
    flightNumber: 'br 198',
    airlineName: '長榮航空',
    depIata: 'tpe',
    arrIata: 'nrt',
    depDate: '2026-12-01',
    depTime: '07:30',
    arrTime: '11:45',
    depUtcOffset: '+8',
    arrUtcOffset: '+9',
  });

  test('says nobody looked it up', () => {
    expect(built(typed).scheduleSource).toBe('user');
  });

  test('tidies the codes it was given', () => {
    const flight = built(typed);

    expect([flight.flightNumber, flight.airlineCode]).toEqual(['BR198', 'BR']);
    expect([flight.depIata, flight.arrIata]).toEqual(['TPE', 'NRT']);
  });

  test('reads each time on its own airport\'s offset', () => {
    const flight = built(typed);

    // 07:30 at UTC+8 is 23:30 the day before.
    expect(flight.depScheduledUtc).toBe(Date.UTC(2026, 10, 30, 23, 30));
    expect(flight.durationMinutes).toBe(195);
  });

  test('has no position, country or distance, since nothing said what they are', () => {
    const flight = built(typed);

    expect(flight.depLat).toBeNull();
    expect(flight.depCountry).toBeNull();
    expect(flight.distanceKm).toBeNull();
  });

  test('uses the code for the airline when no name was typed', () => {
    expect(built({ ...typed, airlineName: '' }).airlineName).toBe('BR');
  });

  test('takes a blank arrival date as the departure date', () => {
    expect(built(typed).arrScheduledUtc).toBeGreaterThan(built(typed).depScheduledUtc);
  });

  describe('is refused', () => {
    test.each([
      ['without a flight number', { flightNumber: '' }, '航班編號'],
      ['without airports', { depIata: '' }, 'IATA'],
      ['without a date', { depDate: '' }, '起飛日期'],
      ['without a departure time', { depTime: '' }, '起飛時間'],
      ['without an arrival time', { arrTime: '' }, '抵達時間'],
      ['without an offset to read the time by', { arrUtcOffset: '' }, 'UTC 偏移'],
      ['with half-hour offsets it cannot hold', { arrUtcOffset: '+5:30' }, '整點'],
      ['with a date that does not exist', { depDate: '2026-02-30' }, '起飛日期'],
      ['arriving before it leaves', { arrTime: '06:00' }, '早於'],
    ])('%s', (_name, fields, message) => {
      expect(refusal({ ...typed, ...fields })).toContain(message);
    });
  });
});

// The sheet takes past trips too. Typing one in is the user's word that it was
// flown, and nothing later will say so: a clock no longer finishes a flight.
describe('a flight already over when it is saved', () => {
  const past = { ...oka, depScheduledUtc: NOW - 7200000, arrScheduledUtc: NOW - 3600000 };

  test('is saved as flown', () => {
    const flight = built(form({ lookedUp: past }));

    expect(flight.isFinished).toBe(true);
    expect(flight.status).toBe('LANDED');
  });

  test('unless it was cancelled', () => {
    const flight = built(form({ lookedUp: { ...past, status: 'CANCELLED' } }));

    expect(flight.isFinished).toBe(false);
    expect(flight.status).toBe('CANCELLED');
  });

  test('a flight still to come is not', () => {
    const flight = built(form({ lookedUp: oka }));

    expect(flight.isFinished).toBe(false);
    expect(flight.status).toBe('SCHEDULED');
  });
});

describe('formFromTicket', () => {
  test('keeps the lookup and the seat from the ticket', () => {
    const filled = formFromTicket(ticket, [oka], EMPTY_FLIGHT_FORM);

    expect(filled.lookedUp).toBe(oka);
    expect(filled.seat).toBe('12A');
  });

  test('shows the date and time on the departure airport\'s clocks', () => {
    const filled = formFromTicket({ ...ticket, time: null }, [oka], EMPTY_FLIGHT_FORM);

    expect([filled.depDate, filled.depTime]).toEqual(['2027-03-03', '15:25']);
  });

  test('takes the leg leaving at the time on the ticket when a number flies several', () => {
    const earlier: LookedUpFlight = {
      ...oka,
      depIata: 'KIX',
      depScheduledUtc: Date.UTC(2027, 2, 3, 0, 0),
    };

    expect(formFromTicket(ticket, [earlier, oka], EMPTY_FLIGHT_FORM).lookedUp?.depIata).toBe('OKA');
  });

  test('takes the first leg when the ticket gives no time to choose by', () => {
    const later: LookedUpFlight = { ...oka, depIata: 'KIX' };
    const noTime = { ...ticket, time: null };

    expect(formFromTicket(noTime, [oka, later], EMPTY_FLIGHT_FORM).lookedUp?.depIata).toBe('OKA');
  });

  test('a seat already typed stays when the ticket has none', () => {
    const typed = form({ seat: '30C' });

    expect(formFromTicket({ ...ticket, seat: null }, [oka], typed).seat).toBe('30C');
  });

  test('the notes stay', () => {
    expect(formFromTicket(ticket, [oka], form({ notes: '靠窗' })).notes).toBe('靠窗');
  });

  describe('with nothing found', () => {
    test('fills in what the ticket gave', () => {
      const filled = formFromTicket(ticket, [], EMPTY_FLIGHT_FORM);

      expect([filled.flightNumber, filled.depDate, filled.depTime, filled.seat]).toEqual([
        'JX871',
        '2027-03-03',
        '15:25',
        '12A',
      ]);
      expect(filled.lookedUp).toBeNull();
    });

    test('leaves what the user typed alone', () => {
      expect(formFromTicket(ticket, [], form({ depIata: 'OKA' })).depIata).toBe('OKA');
    });

    test('does not keep an earlier lookup', () => {
      expect(formFromTicket(ticket, [], form({ lookedUp: oka })).lookedUp).toBeNull();
    });
  });
});

describe('editForm', () => {
  const looked = form({ flightNumber: 'JX871', depDate: '2027-03-03', lookedUp: oka });

  // A lookup answers for one number on one date.
  test('changing the flight number or the date drops the lookup', () => {
    expect(editForm(looked, 'flightNumber', 'JX872').lookedUp).toBeNull();
    expect(editForm(looked, 'depDate', '2027-03-04').lookedUp).toBeNull();
  });

  test('changing anything else keeps it', () => {
    expect(editForm(looked, 'seat', '12A').lookedUp).toBe(oka);
    expect(editForm(looked, 'notes', '靠窗').lookedUp).toBe(oka);
  });

  test('sets the field', () => {
    expect(editForm(looked, 'seat', '12A').seat).toBe('12A');
  });
});

describe('legsFoundMessage', () => {
  test('names the one flight it found', () => {
    expect(legsFoundMessage([{ flightNumber: 'BR198' }])).toBe('已辨識 BR198');
  });

  test('says how many there are when a ticket holds more than one', () => {
    expect(legsFoundMessage([{ flightNumber: 'BR198' }, { flightNumber: 'BR197' }])).toBe(
      '已辨識 2 段航班',
    );
  });
});
