import { memo, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { findAirport } from '../flights/airports';
import {
  createAeroDataBoxPort,
  shouldPollFlight,
  syncFlightStatus,
} from '../flights/flightStatusApi';
import type { FlightRecord } from '../flights/types';
import { database } from '../store/database';
import { listFlights, updateFlight } from '../store/flights';
import { AddFlightSheet } from './AddFlightSheet';
import { FlightDetailSheet } from './FlightDetailSheet';
import { PressScale } from './PressScale';
import { radius, theme } from './theme';

interface FlightsScreenProps {
  onViewFlightOnMap?: (flight: FlightRecord) => void;
}

export const FlightsScreen = memo(function FlightsScreen({
  onViewFlightOnMap,
}: FlightsScreenProps = {}) {
  const [flights, setFlights] = useState<FlightRecord[]>([]);
  const [filter, setFilter] = useState<'active' | 'finished'>('active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [selectedFlight, setSelectedFlight] = useState<FlightRecord | null>(null);

  const refreshFlights = useCallback(async () => {
    try {
      const db = await database();
      const all = await listFlights(db);

      const apiKey = process.env.EXPO_PUBLIC_FLIGHT_API_KEY;
      const port = createAeroDataBoxPort(apiKey);
      const now = Date.now();

      const synced: FlightRecord[] = [];
      for (const f of all) {
        if (shouldPollFlight(f, now)) {
          const next = await syncFlightStatus(f, port, now);
          if (next.status !== f.status || next.depGate !== f.depGate || next.isFinished !== f.isFinished) {
            await updateFlight(db, f.id, next);
          }
          synced.push(next);
        } else {
          synced.push(f);
        }
      }

      setFlights(synced);
    } catch {
      // Ignore background refresh errors
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshFlights();
  }, [refreshFlights]);

  useEffect(() => {
    void refreshFlights();
  }, [refreshFlights]);

  const activeFlights = flights.filter((f) => !f.isFinished);
  const finishedFlights = flights.filter((f) => f.isFinished);
  const displayedFlights = filter === 'active' ? activeFlights : finishedFlights;

  const handleFlightAdded = useCallback(
    (newFlight: FlightRecord) => {
      setFlights((prev) => [newFlight, ...prev]);
    },
    [],
  );

  const handleFlightUpdated = useCallback(
    (updated: FlightRecord) => {
      setFlights((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setSelectedFlight(updated);
    },
    [],
  );

  const handleFlightDeleted = useCallback(
    (id: string) => {
      setFlights((prev) => prev.filter((f) => f.id !== id));
      setSelectedFlight(null);
    },
    [],
  );

  const renderFlightCard = ({ item }: { item: FlightRecord }) => {
    const depAirport = findAirport(item.depIata);
    const arrAirport = findAirport(item.arrIata);

    const now = Date.now();
    const diffMs = item.depScheduledUtc - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    let countdownText = `${diffDays}d`;
    if (item.isFinished) {
      countdownText = '已完成';
    } else if (diffDays <= 0) {
      countdownText = '今日出發';
    }

    const formatTime = (utcMs: number) => {
      const d = new Date(utcMs);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    return (
      <PressScale
        style={styles.card}
        onPress={() => setSelectedFlight(item)}
      >
        {/* Card Top: Flight Number & Status */}
        <View style={styles.cardHeader}>
          <View style={styles.airlineInfo}>
            <Text style={styles.flightNumberText}>{item.flightNumber}</Text>
            <Text style={styles.airlineNameText} numberOfLines={1}>
              {item.airlineName}
            </Text>
          </View>
          <View
            style={[
              styles.cardStatusBadge,
              item.isFinished && styles.cardStatusBadgeFinished,
            ]}
          >
            <Text style={styles.cardStatusText}>
              {item.isFinished ? 'FINISHED' : item.status}
            </Text>
          </View>
        </View>

        {/* Card Middle: Route & Times */}
        <View style={styles.cardRouteRow}>
          <View style={styles.iataCol}>
            <Text style={styles.iataText}>{item.depIata}</Text>
            <Text style={styles.airportCityText}>{depAirport?.cityZh ?? item.depIata}</Text>
            <Text style={styles.flightTimeText}>{formatTime(item.depScheduledUtc)}</Text>
          </View>

          <View style={styles.centerCol}>
            <Text style={styles.countdownText}>{countdownText}</Text>
            <View style={styles.planeIconContainer}>
              <View style={styles.routeDash} />
              <Text style={styles.planeIcon}>✈️</Text>
              <View style={styles.routeDash} />
            </View>
            <Text style={styles.distanceText}>{item.distanceMiles} mi</Text>
          </View>

          <View style={[styles.iataCol, styles.alignRight]}>
            <Text style={styles.iataText}>{item.arrIata}</Text>
            <Text style={styles.airportCityText}>{arrAirport?.cityZh ?? item.arrIata}</Text>
            <Text style={styles.flightTimeText}>{formatTime(item.arrScheduledUtc)}</Text>
          </View>
        </View>

        {/* Card Bottom: Gate, Seat & Luggage summary */}
        <View style={styles.cardFooter}>
          {item.depGate ? (
            <View style={styles.signBadge}>
              <Text style={styles.signBadgeText}>↗ Gate {item.depGate}</Text>
            </View>
          ) : null}
          {item.seat ? (
            <View style={styles.infoBadge}>
              <Text style={styles.infoBadgeText}>💺 {item.seat}</Text>
            </View>
          ) : null}
          {item.pnr ? (
            <View style={styles.infoBadge}>
              <Text style={styles.infoBadgeText}>PNR: {item.pnr}</Text>
            </View>
          ) : null}
        </View>
      </PressScale>
    );
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.topHeader}>
        <Text style={styles.pageTitle}>Trips</Text>
        <PressScale
          style={styles.headerAddBtn}
          onPress={() => setAddSheetVisible(true)}
          hitSlop={8}
        >
          <Text style={styles.headerAddBtnText}>＋ 新增</Text>
        </PressScale>
      </View>

      {/* Filter Pills */}
      <View style={styles.filterRow}>
        <PressScale
          style={[styles.pill, filter === 'active' && styles.pillActive]}
          onPress={() => setFilter('active')}
        >
          <Text style={[styles.pillText, filter === 'active' && styles.pillTextActive]}>
            Active ({activeFlights.length})
          </Text>
        </PressScale>
        <PressScale
          style={[styles.pill, filter === 'finished' && styles.pillActive]}
          onPress={() => setFilter('finished')}
        >
          <Text style={[styles.pillText, filter === 'finished' && styles.pillTextActive]}>
            Finished ({finishedFlights.length})
          </Text>
        </PressScale>
      </View>

      {/* Flight List */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={theme.textFaint} />
        </View>
      ) : displayedFlights.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullRefresh}
              tintColor={theme.textFaint}
            />
          }
        >
          <Text style={styles.emptyIcon}>✈️</Text>
          <Text style={styles.emptyTitle}>
            {filter === 'active' ? '目前沒有即將出發的航班' : '尚無已完成的飛行記錄'}
          </Text>
          <Text style={styles.emptyDesc}>點擊右下角「＋」新增機票與航班</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={displayedFlights}
          keyExtractor={(item) => item.id}
          renderItem={renderFlightCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullRefresh}
              tintColor={theme.textFaint}
            />
          }
        />
      )}

      {/* Floating Action Button */}
      <PressScale
        style={styles.fab}
        onPress={() => setAddSheetVisible(true)}
        hitSlop={8}
      >
        <Text style={styles.fabIcon}>＋</Text>
      </PressScale>

      {/* Add Flight Modal Sheet */}
      <AddFlightSheet
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        onFlightAdded={handleFlightAdded}
      />

      {/* Flight Detail Modal Sheet */}
      <FlightDetailSheet
        flight={selectedFlight}
        visible={selectedFlight !== null}
        onClose={() => setSelectedFlight(null)}
        onFlightUpdated={handleFlightUpdated}
        onFlightDeleted={handleFlightDeleted}
        onViewOnMap={onViewFlightOnMap}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
    paddingTop: 64,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  pageTitle: {
    color: theme.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  headerAddBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.card,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.4)',
  },
  headerAddBtnText: {
    color: '#818cf8',
    fontSize: 13,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  pillActive: {
    backgroundColor: theme.flightIndigo,
    borderColor: theme.flightIndigo,
  },
  pillText: {
    color: theme.textFaint,
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 96,
    gap: 14,
  },
  card: {
    backgroundColor: theme.cardDark,
    borderRadius: radius.card,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  airlineInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flightNumberText: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '800',
  },
  airlineNameText: {
    color: theme.textFaint,
    fontSize: 12,
    flexShrink: 1,
  },
  cardStatusBadge: {
    backgroundColor: theme.flightIndigo,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  cardStatusBadgeFinished: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  cardStatusText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iataCol: {
    flex: 1,
    gap: 2,
  },
  alignRight: {
    alignItems: 'flex-end',
  },
  iataText: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '900',
  },
  airportCityText: {
    color: theme.textMuted,
    fontSize: 12,
  },
  flightTimeText: {
    color: theme.onTimeGreen,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  centerCol: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  countdownText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '800',
  },
  planeIconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  routeDash: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  planeIcon: {
    fontSize: 12,
  },
  distanceText: {
    color: theme.textFaint,
    fontSize: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  signBadge: {
    backgroundColor: theme.airportSignBg,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sign,
  },
  signBadgeText: {
    color: theme.airportSignText,
    fontSize: 10,
    fontWeight: '800',
  },
  infoBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  infoBadgeText: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: theme.flightIndigo,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.flightIndigo,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  fabIcon: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '600',
    marginTop: -2,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
    marginTop: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyDesc: {
    color: theme.textFaint,
    fontSize: 12,
    textAlign: 'center',
  },
});
