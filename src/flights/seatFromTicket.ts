/**
 * The seat for a flight already saved, from its boarding pass. A pass is only taken
 * for its own flight: one for another number, or another day, must change nothing.
 */

import { cleanFlightNumber } from './flightNumber';
import type { TicketFacts } from './ticketFacts';

export type SeatFromTicket = { ok: true; seat: string } | { ok: false; message: string };

/** The same day, or the same month and day when the pass printed no year. */
function sameDay(ticket: TicketFacts, depDate: string): boolean {
  if (!ticket.date) return true;
  return ticket.yearGuessed ? ticket.date.slice(5) === depDate.slice(5) : ticket.date === depDate;
}

export function seatFromTicket(
  flight: { flightNumber: string; depDate: string },
  tickets: readonly TicketFacts[],
): SeatFromTicket {
  if (tickets.length === 0) return { ok: false, message: '辨識不到航班，請再拍一次' };

  const number = cleanFlightNumber(flight.flightNumber);
  const sameNumber = tickets.filter((ticket) => cleanFlightNumber(ticket.flightNumber) === number);
  const ours = sameNumber.find((ticket) => sameDay(ticket, flight.depDate));

  if (!ours) {
    const other = sameNumber[0];
    if (other?.date) {
      const [, month, day] = other.date.split('-').map(Number);
      return { ok: false, message: `這張是 ${month}/${day} 的 ${other.flightNumber}，不是這班` };
    }
    const read = tickets.map((ticket) => ticket.flightNumber).join('、');
    return { ok: false, message: `這張是 ${read}，不是這班` };
  }
  return ours.seat ? { ok: true, seat: ours.seat } : { ok: false, message: '這張登機證上找不到座位' };
}
