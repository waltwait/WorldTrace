/**
 * A flight number as the flight is called. Tickets pad it to four digits, BR0117
 * for BR117, and that is not a number anything else knows it by.
 */
export function cleanFlightNumber(text: string): string {
  return text
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/^([A-Z0-9]{2})0+(?=\d)/, '$1');
}
