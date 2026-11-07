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
  let failure: unknown = null;

  try {
    for (const turn of TURNS) {
      // One turn failing says nothing about the others, or about what was already
      // read: it used to throw all of that away.
      try {
        const tickets = await readTurn(reader, uri, turn, now);
        if (score(tickets) > score(best)) best = tickets;
        if (score(best) === EVERYTHING) break;
      } catch (error) {
        failure ??= error;
      }
    }

    if (best.length === 0 && failure !== null) throw failure;
    return best;
  } finally {
    reader.discard(uri);
  }
}

async function readTurn(
  reader: TicketImageReader,
  uri: string,
  turn: number,
  now: number,
): Promise<TicketFacts[]> {
  const image = turn === 0 ? uri : await reader.rotate(uri, turn);
  try {
    return extractTickets(await reader.read(image), now);
  } finally {
    if (image !== uri) reader.discard(image);
  }
}

interface Releasable {
  release(): void;
}

/**
 * A turned copy of a picture, from an image manipulator's context.
 *
 * The context has to outlive the render. Android cancels a render when its context
 * is released, and the garbage collector releases one nothing refers to, which is
 * all a chain ending in renderAsync leaves: "Context.renderAsync has been rejected",
 * whenever a collection fell during the render. Releasing it afterwards keeps the
 * reference alive until then, and hands the bitmap back sooner besides.
 */
export async function turnedCopy<Image extends Releasable>(
  context: Releasable & { rotate(degrees: number): unknown; renderAsync(): Promise<Image> },
  degrees: number,
  save: (image: Image) => Promise<{ uri: string }>,
): Promise<string> {
  try {
    context.rotate(degrees);
    const image = await context.renderAsync();
    try {
      return (await save(image)).uri;
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
}

/**
 * The text extractor builds a java.io.File from what it is given, and a file URI
 * is not a path: every read would fail with "File not found".
 */
export function localPath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}
