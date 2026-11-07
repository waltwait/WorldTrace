/**
 * The flights, held once for every page that shows them: the overview's next
 * flight, the 航班 page, the arcs on the map and the passport.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { syncReminders } from '../flights/expoReminders';
import { settleDeparted } from '../flights/flightDisplay';
import { createAeroDataBoxPort } from '../flights/flightStatusApi';
import type { FlightRecord } from '../flights/types';
import { apiKey } from '../settings/expoKeyStore';
import { database } from '../store/database';
import { refreshDueFlights } from '../store/flightRefresh';
import { listFlights } from '../store/flights';

export interface FlightsState {
  flights: FlightRecord[];
  loading: boolean;
  refreshing: boolean;
  failed: boolean;
  pullToRefresh: () => Promise<void>;
  added: (flight: FlightRecord) => void;
  updated: (flight: FlightRecord) => void;
  removed: (id: string) => void;
}

export function useFlights(): FlightsState {
  const [stored, setFlights] = useState<FlightRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const db = await database();
      // What is on the phone first: the polls that follow can take as long as
      // the network does.
      setFlights(await listFlights(db));
      setLoading(false);
      setFailed(false);

      const port = createAeroDataBoxPort((await apiKey('flightStatus')) ?? undefined);
      setFlights(await refreshDueFlights(db, port, Date.now()));
    } catch {
      // Said on the page: an empty list would claim there are no flights.
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Coming back to the app can be the moment a flight has left. A new array is
  // enough for that; the polls keep to their own schedule.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setFlights((prev) => [...prev]);
    });
    return () => subscription.remove();
  }, []);

  const flights = useMemo(() => settleDeparted(stored, Date.now()), [stored]);

  // Whenever the flights change: a seat filled in, a delay, a flight deleted.
  useEffect(() => {
    void syncReminders(stored, Date.now()).catch((error) =>
      console.warn('[WorldTrace] reminders not set', error),
    );
  }, [stored]);

  const pullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
  }, [refresh]);

  const added = useCallback((flight: FlightRecord) => {
    setFlights((prev) => [flight, ...prev]);
  }, []);

  const updated = useCallback((flight: FlightRecord) => {
    setFlights((prev) => prev.map((f) => (f.id === flight.id ? flight : f)));
  }, []);

  const removed = useCallback((id: string) => {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return { flights, loading, refreshing, failed, pullToRefresh, added, updated, removed };
}
