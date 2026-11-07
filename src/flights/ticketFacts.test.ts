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
// The places are the one addition, to choose a leg, and they are never saved.
test('carries nothing but the flight, date, time, seat and places', () => {
  const [ticket] = extractTickets(MAIL, NOW);
  expect(Object.keys(ticket).sort()).toEqual([
    'date',
    'flightNumber',
    'places',
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
    expect(extractTickets(ROUND_TRIP, NOW).map(({ places: _places, ...facts }) => facts)).toEqual([
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
    expect(extractTickets(['BR198'], NOW).map(({ places: _places, ...facts }) => facts)).toEqual([
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

// A boarding pass that heads its departure with one word, and prints its boarding
// time in the same form. Recognition's blocks come back in no order to rely on.
describe('a boarding pass that says only DEPARTURE', () => {
  const PASS = [
    'FLIGHT\nCX198',
    'BOARDING TIME\n22:15',
    'DATE\n14 JUN',
    'DEPARTURE\n22:50',
    'SEAT\n12C',
    'PLEASE BE AT THE BOARDING GATE 35 MINS PRIOR TO DEPARTURE.',
  ];

  test('gives the departure, not the boarding time', () => {
    expect(extractTickets(PASS, NOW)[0].time).toBe('22:50');
  });

  test('gives it with the two times the other way round', () => {
    const swapped = ['FLIGHT\nCX198', 'DATE\n14 JUN', '22:50', 'DEPARTURE', '22:15', 'BOARDING TIME'];

    expect(extractTickets(swapped, NOW)[0].time).toBe('22:50');
  });

  test('gives it with the times read apart from their labels', () => {
    const apart = ['CX198', '14 JUN', 'BOARDING TIME', 'DEPARTURE', '22:15', '22:50'];

    expect(extractTickets(apart, NOW)[0].time).toBe('22:50');
  });

  test('knows boarding comes first across midnight', () => {
    const late = ['CX198', '14 JUN', 'BOARDING TIME\n23:50', 'DEPARTURE\n00:20'];

    expect(extractTickets(late, NOW)[0].time).toBe('00:20');
  });

  // The word in a sentence is not a label, and the one time here is boarding.
  test('takes nothing from the small print', () => {
    const noLabel = ['CX198', '14 JUN', 'BOARDING TIME\n22:15', 'GATE CLOSES BEFORE DEPARTURE.'];

    expect(extractTickets(noLabel, NOW)[0].time).toBeNull();
  });

  test('needs the word as a label, even with two times to choose from', () => {
    const sentence = ['CX198', '14 JUN', '22:15', '22:50', 'GATE CLOSES BEFORE DEPARTURE.'];

    expect(extractTickets(sentence, NOW)[0].time).toBeNull();
  });

  // Hours apart, these are not a boarding time and its flight.
  test('takes nothing from two times with nothing to do with each other', () => {
    const unrelated = ['CX198', '14 JUN', 'DEPARTURE', '08:10', '22:50'];

    expect(extractTickets(unrelated, NOW)[0].time).toBeNull();
  });
});

// A pass that labels in two languages and lays the labels out as one column and the
// values as another, as recognition reads them: three labels, then three values.
describe('a pass that says DEP TIME, with its values in a column of their own', () => {
  const COLUMNS = [
    'BOARDING PASS',
    'HX198',
    'DEP TIME',
    'GATE',
    'SEAT',
    '0925',
    '208',
    '22H',
    '14JUN SAPPORO CHITOSE',
  ];

  test('finds the departure', () => {
    expect(extractTickets(COLUMNS, NOW)[0].time).toBe('09:25');
  });

  test('finds it with the label read as one word', () => {
    const joined = COLUMNS.map((line) => (line === 'DEP TIME' ? 'DEPTIME' : line));

    expect(extractTickets(joined, NOW)[0].time).toBe('09:25');
  });

  test('still reads the rest', () => {
    expect(extractTickets(COLUMNS, NOW)[0]).toMatchObject({
      flightNumber: 'HX198',
      date: '2026-06-14',
      seat: '22H',
    });
  });

  // Another time's label in between means the next time is that one's.
  test('stops at the next label that is a time', () => {
    const boarding = ['HX198', '14JUN', 'DEP TIME', 'BOARDING TIME', '0855', 'SEAT'];

    expect(extractTickets(boarding, NOW)[0].time).toBeNull();
  });
});

// As ML Kit read a Hong Kong Airlines pass on the phone. The form's printed version,
// V1 2017, came first and passes for a flight; the real number came last.
describe('a pass with a form version printed on it', () => {
  const READ = [
    'V1 2017',
    '144 V',
    'SEAT',
    '22C',
    'GATE',
    'C10',
    'DEP TIME',
    '2140',
    '14JUN HONGKONG',
    'HX 198',
  ];

  test('is the flight, not the version', () => {
    expect(extractTickets(READ, NOW).map((t) => t.flightNumber)).toEqual(['HX198']);
  });

  test('keeps the date, time and seat', () => {
    expect(extractTickets(READ, NOW)[0]).toMatchObject({
      date: '2026-06-14',
      time: '21:40',
      seat: '22C',
    });
  });

  test('is the flight with the version read as one word', () => {
    const joined = READ.map((line) => (line === 'V1 2017' ? 'V12017' : line));

    expect(extractTickets(joined, NOW).map((t) => t.flightNumber)).toEqual(['HX198']);
  });

  // A number that could be a year is only a flight when it is printed like one.
  test('keeps a real flight numbered like a year', () => {
    expect(extractTickets(['CI2017', '14JUN'], NOW).map((t) => t.flightNumber)).toEqual(['CI2017']);
    expect(extractTickets(['CI 2017', '14JUN'], NOW).map((t) => t.flightNumber)).toEqual(['CI2017']);
  });

  test('keeps a flight whose code has a digit, numbered otherwise', () => {
    expect(extractTickets(['5J 560', '14JUN'], NOW).map((t) => t.flightNumber)).toEqual(['5J560']);
  });
});

// Only to tell the legs of one number apart, D7 378 KUL-TPE-KIX: never saved or shown.
describe('the places on a ticket', () => {
  const PASS = ['BOARDING PASS', 'D7 378', '14JUN', 'TAIPEI', 'OSAKA KANSAI', 'TPE KIX', 'SEAT 22C'];
  const places = (lines: string[]) => extractTickets(lines, NOW)[0].places ?? [];

  test('are noted, codes and names alike', () => {
    expect(places(PASS)).toEqual(expect.arrayContaining(['TPE', 'KIX', 'TAIPEI', 'OSAKA', 'KANSAI']));
  });

  test('leave out a name, however it is written', () => {
    const named = [...PASS, 'LEE/AMYMS', 'LEE, AMY MS'];

    expect(places(named)).not.toEqual(expect.arrayContaining(['LEE']));
    expect(places(named)).not.toContain('AMYMS');
    expect(places(named)).not.toContain('AMY');
  });

  test('leave out a booking code and a ticket number', () => {
    const coded = [...PASS, 'Booking reference: QZKMXA', 'ETKT TICKET NUMBER ABCDEF'];

    expect(places(coded)).not.toContain('QZKMXA');
    expect(places(coded)).not.toContain('ABCDEF');
    expect(places(coded)).not.toContain('BOOKING');
  });

  test('keep an airport printed with a number', () => {
    expect(places([...PASS, 'SDJ/005'])).toContain('SDJ');
  });
});

// As ML Kit read a Jetstar pass: a two-digit number, its label read with a space and
// the l as a 1, beside a gate, a baggage code and a booking code all of that shape.
describe('a two-digit flight number', () => {
  const READ = [
    'STRT, BG30, TIG',
    '14: 45',
    '26',
    'QQV18V',
    'Gate:',
    'Date: 14Jun 25',
    'Seat: 3E',
    'F1 ight: GK 98',
    'FLT: GK 98',
  ];

  test('is read from its label', () => {
    expect(extractTickets(READ, NOW).map((t) => t.flightNumber)).toEqual(['GK98']);
  });

  test('keeps the rest of the ticket', () => {
    expect(extractTickets(READ, NOW)[0]).toMatchObject({ date: '2025-06-14', seat: '3E' });
  });

  test.each(['Flight: GK 98', 'Fl ight: GK 98', 'F1 ight: GK 98', 'FLT: GK 98', 'FLIGHT GK98'])(
    'from %s',
    (line) => {
      expect(extractTickets([line, '14JUN'], NOW)[0]?.flightNumber).toBe('GK98');
    },
  );

  // Without the label, two digits are a gate, a baggage allowance, anything.
  test('is not read without its label', () => {
    expect(extractTickets(['Gate: C10', 'BG30', '14JUN'], NOW)).toEqual([]);
  });
});

describe('the places, as the phone reads them', () => {
  const places = (lines: string[]) => extractTickets(['FLIGHT D7 378', '14JUN', ...lines], NOW)[0].places ?? [];

  // 0SAKA for OSAKA: a zero read for the letter, at the start of a word.
  test('put a letter back where recognition read a digit', () => {
    expect(places(['0SAKA KANSAI T1', 'TA1PEI'])).toEqual(expect.arrayContaining(['OSAKA', 'TAIPEI']));
  });

  // A booking code is letters and digits: MHC33B. Not a place, and not to be read.
  test('leave out a word of letters and digits mixed', () => {
    expect(places(['1500 33C QQC33B'])).not.toContain('QQC');
    expect(places(['QQV18V'])).not.toContain('QQV');
  });

  test('leave out the line after a label that hides its value below it', () => {
    expect(places(['PNR:', 'QQKMXA'])).not.toContain('QQKMXA');
    expect(places(['Name:', 'LEE AMY MS'])).not.toContain('LEE');
  });
});

// A booking shown as a table, one flight a row. Recognition reads a table by rows, by
// columns, or with the cells of a row run together, and all three have to work.
describe('a table of flights', () => {
  const facts = (blocks: string[]) =>
    extractTickets(blocks, NOW).map(({ flightNumber, date }) => ({ flightNumber, date }));
  const BOTH = [
    { flightNumber: 'JX198', date: '2026-12-27' },
    { flightNumber: 'JX199', date: '2026-12-30' },
  ];

  test('read by rows', () => {
    expect(
      facts([
        'TPE/PUS JX0198 Economy 2026-12-27 08:25 11:30 OK T1 I',
        'PUS/TPE JX0199 Economy 2026-12-30 12:30 14:15 OK I T1',
      ]),
    ).toEqual(BOTH);
  });

  test('read with the cells of each row run together', () => {
    expect(
      facts([
        'TPE/PUS',
        'PUS TPE',
        'JX0198Economy2026-12-27',
        'JX0199Economy2026-12-30',
        '08:25',
        '12:30',
        '11:30',
        '14:15',
      ]),
    ).toEqual(BOTH);
  });

  // Every number, then every date: the first number goes with the first date.
  test('read by columns', () => {
    expect(
      facts([
        'TPE/PUS\nPUS/TPE',
        'JX0198\nJX0199',
        'Economy\nEconomy',
        '2026-12-27\n2026-12-30',
        '08:25\n12:30',
        '11:30\n14:15',
      ]),
    ).toEqual(BOTH);
  });

  // Departure and arrival columns are in no order to rely on: the lookup has them.
  test('read by columns leaves the times to the lookup', () => {
    const times = extractTickets(['JX0198\nJX0199', '2026-12-27\n2026-12-30', '08:25\n12:30'], NOW).map(
      (t) => t.time,
    );

    expect(times).toEqual([null, null]);
  });

  test('read by columns, with a date printed again below', () => {
    expect(
      facts(['JX0198\nJX0199', '2026-12-27\n2026-12-30', 'Issued for travel on 2026-12-27']),
    ).toEqual(BOTH);
  });

  // Pairing by order is for a table only: a mail can print the return's date first.
  test('does not pair by order when a flight has a date of its own', () => {
    expect(facts(['Return 2027-03-13', 'BR198 2027-03-03', 'BR197'])[0]).toEqual({
      flightNumber: 'BR198',
      date: '2027-03-03',
    });
  });

  test('a year run into a word is still a date', () => {
    expect(facts(['JX0198 Economy2026-12-27'])).toEqual([BOTH[0]]);
  });
});
