/**
 * What a link may be, and what it is called.
 *
 * A link is opened with a tap, so only the web gets in: any other scheme could
 * start an app or run a script. Nothing here fetches the page. Its name is the
 * one typed, or else the site it is on.
 */

import type { FlightLinkRecord, FlightRecord } from './types';

export type ReadLink =
  | { ok: true; url: string; title: string | null }
  | { ok: false; error: string };

const WEB = /^https?:\/\/[^\s/?#@]*@?[^\s/?#.]+(\.[^\s/?#.]+)+([:/?#]\S*)?$/i;
/** What a pasted address without its scheme looks like: a host with a dot in it. */
const BARE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function readLink(input: string, name: string): ReadLink {
  const typed = input.trim();
  const title = name.trim() || null;

  if (WEB.test(typed)) return { ok: true, url: typed, title };
  if (BARE.test(typed)) return { ok: true, url: `https://${typed}`, title };
  if (SCHEME.test(typed) && !/^https?:/i.test(typed)) return { ok: false, error: '只能加網頁連結' };
  return { ok: false, error: '網址不對' };
}

/** The site, as the address says it: the part after any login, without the port or www. */
export function linkHost(url: string): string {
  const authority = /^https?:\/\/([^/?#]*)/i.exec(url)?.[1] ?? url;
  const host = authority.slice(authority.lastIndexOf('@') + 1).replace(/:\d*$/, '');
  return host.toLowerCase().replace(/^www\./, '');
}

export function linkLabel(link: FlightLinkRecord): string {
  return link.title ?? linkHost(link.url);
}

/** A trip's links, wherever among its flights they are kept, the oldest first. */
export function linksOfTrip(
  links: readonly FlightLinkRecord[],
  trip: { flights: readonly Pick<FlightRecord, 'id'>[] },
): FlightLinkRecord[] {
  const ids = new Set(trip.flights.map((f) => f.id));
  return links.filter((link) => ids.has(link.flightId)).sort((a, b) => a.createdAt - b.createdAt);
}
