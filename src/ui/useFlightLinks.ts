/**
 * Every trip's links, read once and again whenever the flights change: deleting a
 * flight hands its links to another, and the passport has to see where they went.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FlightLinkRecord, FlightRecord } from '../flights/types';
import { database } from '../store/database';
import { deleteFlightLink, insertFlightLink, listFlightLinks } from '../store/flightLinks';

export function useFlightLinks(flights: readonly FlightRecord[]) {
  const [links, setLinks] = useState<FlightLinkRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await listFlightLinks(await database());
        if (!cancelled) setLinks(stored);
      } catch (error) {
        console.warn('[WorldTrace] links not read', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flights]);

  const add = useCallback(async (link: FlightLinkRecord) => {
    await insertFlightLink(await database(), link);
    setLinks((current) => [...current, link]);
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteFlightLink(await database(), id);
    setLinks((current) => current.filter((link) => link.id !== id));
  }, []);

  return { links, add, remove };
}
