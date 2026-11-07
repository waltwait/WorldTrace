/**
 * Reading a ticket picture on the phone, and leaving nothing of it behind.
 *
 * The picture holds a name, a booking code and a barcode with both in it, and
 * none of that is wanted: text recognition runs on the phone, the facts come out
 * (ticketFacts.ts), and the picture and every turned copy are deleted. Nothing is
 * uploaded.
 *
 * A boarding pass is usually photographed sideways, so the picture is turned.
 */

import { extractTickets, type TicketFacts } from './ticketFacts';

export interface TicketImageReader {
  /** The text in the picture, as blocks of lines. */
  read(uri: string): Promise<string[]>;
  /** A turned copy of the picture. */
  rotate(uri: string, degrees: number): Promise<string>;
  /** Deletes a copy. Missing is fine. */
  discard(uri: string): void;
}

const TURNS = [0, 90, 270, 180];
const EVERYTHING = 3;

/** How much a reading found: facts per flight, so noise read as a flight costs it. */
function score(tickets: readonly TicketFacts[]): number {
  if (tickets.length === 0) return -1;
  const facts = tickets.flatMap((t) => [t.date, t.time, t.seat].filter((f) => f !== null));
  return facts.length / tickets.length;
}

/**
 * Reads the picture each way round and keeps the reading that gives the most.
 * Recognition copes with text on its side but does not read it equally well, and
 * a turn costs about 0.3 s, so stopping at the first passable reading saved
 * nothing and lost the seat and the time.
 */
export async function readTicket(
  reader: TicketImageReader,
  uri: string,
  now: number,
): Promise<TicketFacts[]> {
  let best: TicketFacts[] = [];

  try {
    for (const turn of TURNS) {
      const image = turn === 0 ? uri : await reader.rotate(uri, turn);
      try {
        const tickets = extractTickets(await reader.read(image), now);
        if (score(tickets) > score(best)) best = tickets;
        if (score(best) === EVERYTHING) break;
      } finally {
        if (image !== uri) reader.discard(image);
      }
    }
    return best;
  } finally {
    reader.discard(uri);
  }
}

/**
 * The text extractor builds a java.io.File from what it is given, and a file URI
 * is not a path: every read would fail with "File not found".
 */
export function localPath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}
