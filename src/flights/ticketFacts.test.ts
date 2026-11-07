import { describe, expect, test } from 'vitest';
import { extractTickets } from './ticketFacts';

const NOW = Date.UTC(2026, 10, 7, 2, 0); // 7 November 2026

// What on-device text recognition reads off a booking mail, names taken out.
const MAIL = [
  'ETIHAD\nYour flight is booked',
  "Thanks for booking with Etihad. We're excited to welcome you on board.",
  'Your trip details',
  'Booking reference: QZ7K2M',
  'All times are local to each city',
  'JX 871 Starlux Airlines',
  'Economy',
  'Okinawa\nOKA\n15:25\nWed 03 Mar\nNaha\nTerminal I',
  '01h 45m • Non-stop\nAirbus A330-900neo Passenger',
  'Bronze',
  'Taipei\nTPE\n16:10\nWed 03 Mar\nTaiwan Taoyuan Intl\nTerminal 1',
  'Seat\n-',
  'What to do next',
  '2\n3',
  'Download our app for flight updates',
];

// And off a boarding pass photo, with handwriting on the paper behind it.
const BOARDING_PASS = [
  '8\n163\n(6)\n19000\n5488\n6737\n4885\n135.',
  'BOARDING PASS',
  '0.133\n≥2000\nusd\n6006\n1638',
  'GBA\nGREATER BAY AIRLINES',
  'FLIGHT\nHB703',
  'FROM\nTO\nTPE\nHKG',
  'DATE\n12JUL',
  'DEPARTURE TIME\n1040',
  'BOARDING TIME\n1000',
  'GATE\nB4',
  'SEAT\n62H',
  'PLEASE BE AT THE BOARDING GATE 30 MINS PRIOR TO DEPARTURE.',
  'GATE CLOSES 15 MINUTES BEFORE DEPARTURE.',
  'ETKT2832301513251/1',
  'FLIGHT\nHB703\nDATE\n12JUL\nGATE\nB4\nSEAT\n62H',
];

describe('a booking mail', () => {
  const [ticket, ...rest] = extractTickets(MAIL, NOW);

  test('gives the flight and its date', () => {
    expect(rest).toEqual([]);
    expect(ticket.flightNumber).toBe('JX871');
    expect(ticket.date).toBe('2027-03-03');
  });

  // On the phone the right-hand column came back first, which made 16:10, the
  // arrival, the departure. Blocks of text have no order to rely on, and nothing
  // here says which time is which: the lookup has the real ones.
  test('leaves the time out when it prints two with nothing to tell them apart', () => {
    expect(ticket.time).toBeNull();
    const rightColumnFirst = ['JX 871', 'TPE\n16:10', 'OKA\n15:25', 'Wed 03 Mar'];
    expect(extractTickets(rightColumnFirst, NOW)[0].time).toBeNull();
  });

  // And on the phone the departure's block came back before the flight number.
  test('looks at the whole ticket when it holds one flight', () => {
    const shuffled = ['OKA\n15:25', 'JX 871', 'Wed 03 Mar', 'TPE\n16:10'];
    expect(extractTickets(shuffled, NOW)[0].time).toBeNull();

    const seatFirst = ['SEAT\n62H', 'FLIGHT\nHB703', 'DATE\n12JUL'];
    expect(extractTickets(seatFirst, NOW)[0].seat).toBe('62H');
  });

  test('takes a time printed once, or the same time printed twice', () => {
    expect(extractTickets(['BR198 2026-12-31 07:30'], NOW)[0].time).toBe('07:30');
    expect(extractTickets(['BR198 2026-12-31 07:30', '7:30'], NOW)[0].time).toBe('07:30');
  });

  test('is sure of the year: the printed weekday settles it', () => {
    expect(ticket.yearGuessed).toBe(false);
  });

  test('has no seat when it prints a dash', () => {
    expect(ticket.seat).toBeNull();
  });
});

describe('a boarding pass photo', () => {
  const tickets = extractTickets(BOARDING_PASS, NOW);
  const [ticket] = tickets;

  test('counts the stub as the same flight', () => {
    expect(tickets).toHaveLength(1);
  });

  test('gives the flight, the date, the seat and the departure, not the boarding time', () => {
    expect(ticket.flightNumber).toBe('HB703');
    expect(ticket.date).toBe('2026-07-12');
    expect(ticket.seat).toBe('62H');
    expect(ticket.time).toBe('10:40');
  });

  test('says the year is a guess', () => {
    expect(ticket.yearGuessed).toBe(true);
  });

  test('leaves the time out rather than take the boarding time', () => {
    const skewed = ['FLIGHT\nHB703', 'DATE\n12JUL', 'DEPARTURE TIME\nBOARDING TIME\n1000'];
    expect(extractTickets(skewed, NOW)[0].time).toBeNull();
  });
});

// The point of reading this way: nothing else comes out of a ticket.
test('carries nothing but the flight, date, time and seat', () => {
  const [ticket] = extractTickets(MAIL, NOW);
  expect(Object.keys(ticket).sort()).toEqual([
    'date',
    'flightNumber',
    'seat',
    'time',
    'yearGuessed',
  ]);
  expect(JSON.stringify(ticket)).not.toContain('QZ7K2M');
});

// One button takes any picture, so what kind it is comes from what it says. Only
// matters for a date with no year and no weekday.
describe('a date with nothing to fix its year', () => {
  const year = (...text: string[]) => extractTickets(['BR198 12JUL', ...text], NOW)[0].date;

  test('on a boarding pass is the last time that date came round', () => {
    expect(year('BOARDING PASS')).toBe('2026-07-12');
    expect(year('Boarding Time 1000')).toBe('2026-07-12');
    expect(year('登機證')).toBe('2026-07-12');
  });

  test('on anything else is the next time', () => {
    expect(year('Your flight is booked')).toBe('2027-07-12');
  });
});

describe('several flights on one ticket', () => {
  const ROUND_TRIP = [
    'BR 198 Wed 03 Mar 08:50\nSeat 24A',
    'BR 197 Sat 13 Mar 14:20\nSeat 31C',
  ];

  test('are each given their own date, time and seat', () => {
    expect(extractTickets(ROUND_TRIP, NOW)).toEqual([
      { flightNumber: 'BR198', date: '2027-03-03', time: '08:50', seat: '24A', yearGuessed: false },
      { flightNumber: 'BR197', date: '2027-03-13', time: '14:20', seat: '31C', yearGuessed: false },
    ]);
  });
});

// Read sideways, a boarding pass picked up "O1110" from the printing on the paper
// behind it, as a second flight on the same date.
describe('something that only looks like a flight number', () => {
  const NOISE = ['FLIGHT\nHB703', 'DATE\n12JUL', 'SEAT\n62H', 'O1110\n0110'];

  test('is dropped when it has no date of its own and a real flight has', () => {
    const tickets = extractTickets(NOISE, NOW);
    expect(tickets.map((t) => t.flightNumber)).toEqual(['HB703']);
  });

  test('is still dropped when it comes first', () => {
    const tickets = extractTickets(['O1110', 'FLIGHT\nHB703', 'DATE\n12JUL'], NOW);
    expect(tickets.map((t) => t.flightNumber)).toEqual(['HB703']);
  });

  // The phone read SEAT and 62H fine, but after the false number, so they went
  // to it and left with it.
  test('leaves what was printed after it to the real flight', () => {
    const [ticket] = extractTickets(
      ['FLIGHT\nHB703', 'DATE\n12JUL', 'O1110', 'SEAT\n62H', 'DEPARTURE TIME\n1040'],
      NOW,
    );

    expect([ticket.seat, ticket.time]).toEqual(['62H', '10:40']);
  });

  test('a lone number with no date anywhere is kept for the form to ask about', () => {
    expect(extractTickets(['HB703'], NOW).map((t) => t.flightNumber)).toEqual(['HB703']);
  });
});

describe('what counts as a flight number', () => {
  const number = (text: string) => extractTickets([text], NOW)[0]?.flightNumber;

  test('not the digits of a date', () => {
    expect(number('Dec 01 2026 CI501 TPE NRT')).toBe('CI501');
  });

  test('not a word followed by a time', () => {
    expect(number('Departure at 0730 CI501')).toBe('CI501');
    expect(number('leaves on 1130, flight BR198')).toBe('BR198');
  });

  test('not a word and a time with no flight beside them', () => {
    expect(extractTickets(['leaves at 0730'], NOW)).toEqual([]);
    expect(extractTickets(['LEAVES AT 0730'], NOW)).toEqual([]);
  });

  test('not an aircraft type, a booking code or a ticket number', () => {
    expect(extractTickets(['A350', 'QZ7K2M', 'ETKT2832301513251/1'], NOW)).toEqual([]);
  });

  test('a code with a digit in it', () => {
    expect(number('3K721 SIN')).toBe('3K721');
  });

  test('in small letters, or with a space when the code is in capitals', () => {
    expect(number('ci501 tpe')).toBe('CI501');
    expect(number('BR 198')).toBe('BR198');
  });

  test('nothing at all if only a date looks like one', () => {
    expect(extractTickets(['Dec 01 2026'], NOW)).toEqual([]);
  });
});

describe('how a date can be written', () => {
  const date = (text: string) => extractTickets([`BR198 ${text}`], NOW)[0].date;

  test.each([
    ['2026-12-31', '2026-12-31'],
    ['2026/12/1', '2026-12-01'],
    ['2026.12.31', '2026-12-31'],
    ['2026年12月31日', '2026-12-31'],
    ['31 Dec 2026', '2026-12-31'],
    ['31DEC26', '2026-12-31'],
    ['December 31, 2026', '2026-12-31'],
    ['Dec 31', '2026-12-31'],
    ['12月31日', '2026-12-31'],
  ])('%s', (written, expected) => {
    expect(date(written)).toBe(expected);
  });

  test('a time after a date is not its year', () => {
    expect(date('03 Mar 15:25')).toBe('2027-03-03');
  });

  test('a date that does not exist is not a date', () => {
    expect(date('2026-02-30')).toBeNull();
  });

  test('a Chinese weekday settles the year as well', () => {
    const [ticket] = extractTickets(['BR198 3月3日 週三'], NOW);
    expect(ticket.date).toBe('2027-03-03');
    expect(ticket.yearGuessed).toBe(false);
  });

  test('takes the date printed with the flight, not one earlier on the page', () => {
    const [ticket] = extractTickets(['Sent 05 Nov 2026', 'BR198', '2026-12-31'], NOW);
    expect(ticket.date).toBe('2026-12-31');
  });

  test('falls back to one earlier on the page when the flight has none of its own', () => {
    const [ticket] = extractTickets(['2026-12-31', 'BR198'], NOW);
    expect(ticket.date).toBe('2026-12-31');
  });

  test('a flight with no date anywhere keeps its number', () => {
    expect(extractTickets(['BR198'], NOW)).toEqual([
      { flightNumber: 'BR198', date: null, time: null, seat: null, yearGuessed: false },
    ]);
  });
});

describe('a seat', () => {
  const seat = (text: string) => extractTickets([`BR198 2026-12-31\n${text}`], NOW)[0].seat;

  test('is taken only where it is labelled', () => {
    expect(seat('Seat 10K')).toBe('10K');
    expect(seat('座位：24A')).toBe('24A');
    expect(seat('第 2 航廈 1A 門')).toBeNull();
  });

  test('can sit on the line under its label', () => {
    expect(seat('SEAT\n62H')).toBe('62H');
  });

  // Recognition reads a table a column or a row at a time, so a value can end up
  // well away from its label. A line that is nothing but a seat is one, as long
  // as the ticket has a seat label at all.
  test('can sit anywhere on the ticket, on a line of its own', () => {
    expect(seat('GATE\nSEAT\nDATE\nFLIGHT\nB4\n62H')).toBe('62H');
  });

  test('is not any line that looks like one, on a ticket with no seat label', () => {
    expect(seat('GATE\n62H')).toBeNull();
  });
});

// Laid out as a paper pass with a stub: the flight and the date joined by a slash,
// the number padded to four digits, a boarding time and no departure time.
describe('a boarding pass that joins the flight and the date', () => {
  const PAPER = [
    'ECONOMY CLASS',
    'GATE\n3',
    'BOARDING TIME\n00\n19:40',
    'SEAT\n22C',
    'BR0198/14JUN',
    'Flight\nFrom-To',
    'NRT -TPE',
    'NRT/005',
    'BR0198/14JUN\nNRT-TPE',
    'EVAAIR',
  ];
  const tickets = extractTickets(PAPER, NOW);

  test('is one flight, though the stub prints it again', () => {
    expect(tickets).toHaveLength(1);
  });

  // The ticket pads the number. The flight is BR198, and that is what gets looked up.
  test('drops the padding from the number', () => {
    expect(tickets[0].flightNumber).toBe('BR198');
  });

  test('reads the date behind the slash', () => {
    expect(tickets[0].date?.slice(5)).toBe('06-14');
  });

  test('finds the seat', () => {
    expect(tickets[0].seat).toBe('22C');
  });

  // The only clock on it is when boarding opens, and a pen may have changed even that.
  test('does not take the boarding time for the departure', () => {
    expect(tickets[0].time).toBeNull();
  });

  describe('misread', () => {
    const lastTimeRound = (lines: string[]) => extractTickets(lines, NOW)[0].date?.slice(0, 4);
    const past = extractTickets(PAPER, NOW)[0].date?.slice(0, 4);

    test('is still a boarding pass with its label half read', () => {
      const misread = PAPER.map((line) => line.replace('BOARDING TIME', 'BOARDING TOMET'));

      expect(lastTimeRound(misread)).toBe(past);
    });

    test('is still a boarding pass from its gate alone', () => {
      const noLabel = PAPER.filter((line) => !line.startsWith('BOARDING'));

      expect(lastTimeRound(noLabel)).toBe(past);
    });
  });
});

test('a mail keeps its only time: it has no boarding time to confuse it with', () => {
  const [ticket] = extractTickets(['Flight JX871', '03 Mar 2027 15:25'], NOW);

  expect(ticket.time).toBe('15:25');
});

// As ML Kit on the phone really reads a paper pass: the zero comes back as the letter
// O, on every turn of the picture, and the slash sometimes as a bar. Vision on a Mac
// reads the same ticket correctly, so a test against that proves nothing.
describe('a flight number with its zero read as the letter O', () => {
  const READ = [
    'GATE\n3',
    'BOARDING TIME',
    'SEAT\n22C',
    'BRO198/14 JUN',
    'BRO198|14JUN',
    'NRT /005',
    '35',
    '011001000',
  ];

  test('is put right', () => {
    expect(extractTickets(READ, NOW).map((t) => t.flightNumber)).toEqual(['BR198']);
  });

  test('keeps the rest of the ticket', () => {
    const [ticket] = extractTickets(READ, NOW);

    expect(ticket.date).toBe('2026-06-14');
    expect(ticket.seat).toBe('22C');
  });

  test.each(['BRO198/14JUN', 'BRO198|14JUN', 'BRO198 / 14 JUN', 'bro198/14jun'])('from %s', (line) => {
    expect(extractTickets([line], NOW)[0]?.flightNumber).toBe('BR198');
  });

  // A booking code is six letters and digits too, and it is never to be read. Only
  // the date behind it says this is a flight.
  test('is left alone with no date behind it', () => {
    expect(extractTickets(['Booking reference: XYO123', '14 JUN 2027'], NOW)).toEqual([]);
  });

  test('needs a digit, or any word beside a date would do', () => {
    expect(extractTickets(['GOOOO/14JUN'], NOW)).toEqual([]);
  });
});
