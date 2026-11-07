import { describe, expect, test, vi } from 'vitest';
import { localPath, readTicket, type TicketImageReader } from './readTicket';

const NOW = Date.UTC(2026, 10, 7);
const READABLE = ['BOARDING PASS', 'FLIGHT\nHB703', 'DATE\n12JUL', 'DEPARTURE TIME\n1040', 'SEAT\n62H'];

/** An image that only reads the right way up at `upright` degrees. */
function photo(upright: number, text = READABLE) {
  const discarded: string[] = [];
  const reader: TicketImageReader = {
    read: vi.fn(async (uri: string) => (uri === `turned-${upright}` ? text : ['junk'])),
    rotate: vi.fn(async (_uri: string, degrees: number) => `turned-${degrees}`),
    discard: (uri) => void discarded.push(uri),
  };
  return { reader, discarded };
}

describe('readTicket', () => {
  test('reads a picture the right way up without turning it', async () => {
    const reader: TicketImageReader = {
      read: vi.fn(async () => READABLE),
      rotate: vi.fn(async () => 'never'),
      discard: () => {},
    };

    const [ticket] = await readTicket(reader, 'picked', NOW);

    expect(ticket.flightNumber).toBe('HB703');
    expect(reader.rotate).not.toHaveBeenCalled();
  });

  // A boarding pass is usually photographed sideways, and text recognition
  // reads upright text.
  test('turns a sideways picture until it can be read', async () => {
    const { reader } = photo(90);

    const [ticket] = await readTicket(reader, 'picked', NOW);

    expect(ticket.date).toBe('2026-07-12');
    expect(reader.rotate).toHaveBeenCalledTimes(1);
  });

  test('tries every way round before giving up', async () => {
    const { reader } = photo(-1);

    expect(await readTicket(reader, 'picked', NOW)).toEqual([]);
    expect(reader.read).toHaveBeenCalledTimes(4);
  });

  test('keeps a flight number found with no date if nothing better turns up', async () => {
    const { reader } = photo(180, ['HB703']);

    const [ticket] = await readTicket(reader, 'picked', NOW);

    expect(ticket.flightNumber).toBe('HB703');
    expect(ticket.date).toBeNull();
  });

  // On the phone, one sideways boarding pass read like this, in about 0.3 s a turn.
  describe('when a picture reads differently each way round', () => {
    const turns: Record<string, string[]> = {
      picked: ['BOARDING PASS', 'FLIGHT\nHB703', 'DATE\n12JUL'],
      'turned-90': ['BOARDING PASS', 'O11100 12JUL', 'HB703 12JUL', 'SEAT\n62H'],
      'turned-270': READABLE,
      'turned-180': ['junk'],
    };
    const reader = (pages: Record<string, string[]>): TicketImageReader => ({
      read: vi.fn(async (uri: string) => pages[uri] ?? []),
      rotate: vi.fn(async (_uri: string, degrees: number) => `turned-${degrees}`),
      discard: () => {},
    });

    test('takes the reading that gives the most', async () => {
      const [ticket, ...rest] = await readTicket(reader(turns), 'picked', NOW);

      expect(rest).toEqual([]);
      expect([ticket.flightNumber, ticket.time, ticket.seat]).toEqual(['HB703', '10:40', '62H']);
    });

    test('stops as soon as a reading has everything', async () => {
      const r = reader(turns);

      await readTicket(r, 'picked', NOW);

      expect(r.read).toHaveBeenCalledTimes(3);
    });

    // A mail has no seat to find, so nothing ever reads as complete.
    test('reads every way round when none is complete, and keeps the best', async () => {
      const r = reader({ picked: ['BR198 2026-12-31'] });

      const [ticket] = await readTicket(r, 'picked', NOW);

      expect(r.read).toHaveBeenCalledTimes(4);
      expect(ticket.flightNumber).toBe('BR198');
    });
  });

  // Sideways, a number can be legible with the date still garbled.
  test('keeps turning when it has a flight number but no date yet', async () => {
    const reader: TicketImageReader = {
      read: vi.fn(async (uri: string) => (uri === 'picked' ? ['HB703'] : READABLE)),
      rotate: vi.fn(async (_uri: string, degrees: number) => `turned-${degrees}`),
      discard: () => {},
    };

    const [ticket] = await readTicket(reader, 'picked', NOW);

    expect(ticket.date).toBe('2026-07-12');
  });

  // A ticket photo holds a name, a booking code and a barcode. Nothing of it
  // stays once the facts are out.
  test('leaves no copy behind, of the picture or of any turned version', async () => {
    const { reader, discarded } = photo(270);

    await readTicket(reader, 'picked', NOW);

    expect(discarded.sort()).toEqual(['picked', 'turned-270', 'turned-90']);
  });

  test('leaves no copy behind when reading fails, and says so', async () => {
    const discarded: string[] = [];
    const reader: TicketImageReader = {
      read: async () => {
        throw new Error('model not ready');
      },
      rotate: async () => 'never',
      discard: (uri) => void discarded.push(uri),
    };

    await expect(readTicket(reader, 'picked', NOW)).rejects.toThrow('model not ready');
    expect(discarded).toEqual(['picked']);
  });
});

describe('localPath', () => {
  // The text extractor builds a java.io.File from what it is given, and a file
  // URI is not a path: every read failed with "File not found".
  test('makes a file URI a path', () => {
    expect(localPath('file:///data/user/0/app/cache/a.jpg')).toBe('/data/user/0/app/cache/a.jpg');
  });

  test('undoes the escaping a URI brings', () => {
    expect(localPath('file:///data/My%20Photo.jpg')).toBe('/data/My Photo.jpg');
  });

  test('leaves a content URI and a plain path alone', () => {
    expect(localPath('content://media/1')).toBe('content://media/1');
    expect(localPath('/data/a.jpg')).toBe('/data/a.jpg');
  });
});
