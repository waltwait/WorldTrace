/**
 * What the add sheet does with a ticket that holds several flights, kept out
 * of the component so it runs under test.
 *
 * The form shows one leg at a time; the others wait here and are filled in one
 * by one, each after the one before it is saved.
 */

import type { TicketFacts } from '../flights/ticketFacts';

/**
 * The legs still waiting once one is shown: the rest of a new ticket, or, for
 * 查詢 — which asks again about the leg on screen — the ones that were already
 * waiting. Replacing them with what came after that one leg dropped every
 * other leg of the ticket.
 */
export function waitingAfterShowing(
  waiting: readonly TicketFacts[],
  rest: readonly TicketFacts[],
  lookingUpAgain: boolean,
): TicketFacts[] {
  return [...(lookingUpAgain ? waiting : rest)];
}

export interface SaveSteps {
  /** Show the next leg waiting. */
  advance(waiting: TicketFacts[]): Promise<void>;
  /** Empty the sheet: form, queue and the attached ticket. */
  clear(): void;
  /** Start the sheet sliding away. */
  close(): void;
}

/**
 * What saving a flight leaves to do: show the next leg if one is waiting, or
 * close. Either way the sheet is cleared once it has slid away (AfterClose),
 * since a flight from it has been saved: the sheet stays mounted between adds,
 * and closed with a leg still waiting it kept the ticket attached, so the next
 * flight added — any flight, a week later — had it copied onto it.
 *
 * A sheet closed before anything was saved keeps its draft.
 */
export async function finishSave(
  waiting: readonly TicketFacts[],
  afterClose: { add(work: () => void): void },
  steps: SaveSteps,
): Promise<'next' | 'closed'> {
  afterClose.add(steps.clear);
  if (waiting.length > 0) {
    await steps.advance([...waiting]);
    return 'next';
  }
  steps.close();
  return 'closed';
}
