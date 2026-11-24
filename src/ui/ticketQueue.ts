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
