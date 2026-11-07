import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { pastFlights, ticketFor, upcomingFlights } from '../flights/flightDisplay';
import { linkHeir, passportTrips } from '../flights/trips';
import type { FlightRecord } from '../flights/types';
import { database } from '../store/database';
import { expoDocFiles } from '../store/expoDocFiles';
import { deleteFlightAndDocs } from '../store/flightDocs';
import { ask } from './dialog';
import { FadeIn } from './FadeIn';
import { useHomeCountry } from './HomeCountry';
import { CURVE, DURATION, pillOffset, staggerDelay } from './motion';
import { PressScale } from './PressScale';
import { Ticket } from './Ticket';
import { useStyles, useTheme } from './ThemeProvider';
import { radius, TOOLBAR_CLEARANCE, type Theme } from './themes';
import type { FlightsState } from './useFlights';
import { useReducedMotion } from './useReducedMotion';
import { Text } from './Text';

const FILTER_WIDTH = 104;
const FILTER_GAP = 4;

export const FlightsScreen = memo(function FlightsScreen({
  state,
  onOpenFlight,
}: {
  state: FlightsState;
  onOpenFlight: (flight: FlightRecord) => void;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<'active' | 'finished'>('active');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { flights, loading, refreshing, failed, pullToRefresh, removed } = state;
  const { home } = useHomeCountry();

  const filterIndex = filter === 'active' ? 0 : 1;
  const pillX = useRef(new Animated.Value(pillOffset(filterIndex, FILTER_WIDTH, FILTER_GAP))).current;

  useEffect(() => {
    const target = pillOffset(filterIndex, FILTER_WIDTH, FILTER_GAP);
    if (reduced) {
      pillX.setValue(target);
      return;
    }

    const animation = Animated.timing(pillX, {
      toValue: target,
      duration: DURATION.enter,
      easing: Easing.bezier(...CURVE.move),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [filterIndex, pillX, reduced]);

  const shown = filter === 'active' ? upcomingFlights(flights) : pastFlights(flights);

  const finishDelete = useCallback(
    (id: string) => {
      setDeletingId((current) => (current === id ? null : current));
      removed(id);
    },
    [removed],
  );

  const deleteFlight = async (flight: FlightRecord) => {
    const confirmed = await ask({
      title: '刪除航班',
      message: `確定要刪除 ${flight.flightNumber} 嗎？此操作無法復原。`,
      confirmLabel: '刪除',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      // Its trip's links go to another flight of the trip, if it has one.
      const heir = linkHeir(flight.id, passportTrips(flights, home, null));
      await deleteFlightAndDocs(await database(), expoDocFiles, flight.id, heir);
      if (reduced) removed(flight.id);
      else setDeletingId(flight.id);
    } catch (error) {
      await ask({
        title: '無法刪除航班',
        message: error instanceof Error ? error.message : String(error),
        confirmLabel: '好',
      });
    }
  };

  const pill = (value: typeof filter, label: string) => (
    <PressScale style={styles.pill} onPress={() => setFilter(value)}>
      <Text style={[styles.pillText, filter === value && styles.pillTextOn]}>{label}</Text>
    </PressScale>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={shown}
      extraData={deletingId}
      keyExtractor={(flight) => flight.id}
      ItemSeparatorComponent={Gap}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} tintColor={t.muted} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>航班</Text>
          <View style={styles.pills}>
            <Animated.View
              pointerEvents="none"
              style={[styles.pillIndicator, { transform: [{ translateX: pillX }] }]}
            />
            {pill('active', '即將出發')}
            {pill('finished', '已結束')}
          </View>
        </View>
      }
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator color={t.muted} />
        ) : (
          <Text style={styles.empty}>
            {failed
              ? '讀取航班失敗，請下拉重試'
              : filter === 'active'
                ? '目前沒有即將出發的航班'
                : '尚無已完成的飛行記錄'}
          </Text>
        )
      }
      renderItem={({ item, index }) => (
        <FlightRow
          flight={item}
          index={index}
          filterKey={filter}
          leaving={deletingId === item.id}
          onExited={() => finishDelete(item.id)}
          onOpen={() => onOpenFlight(item)}
          onDelete={() => void deleteFlight(item)}
        />
      )}
    />
  );
});

function FlightRow({
  flight,
  index,
  filterKey,
  leaving,
  onExited,
  onOpen,
  onDelete,
}: {
  flight: FlightRecord;
  index: number;
  filterKey: string;
  leaving: boolean;
  onExited: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const reduced = useReducedMotion();
  const exit = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  useEffect(() => {
    if (!leaving) return;
    if (reduced) {
      onExitedRef.current();
      return;
    }

    const ease = Easing.bezier(...CURVE.enter);
    const animation = Animated.parallel([
      Animated.timing(exit, {
        toValue: 0,
        duration: DURATION.exit,
        easing: ease,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.94,
        duration: DURATION.exit,
        easing: ease,
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished) onExitedRef.current();
    });
    return () => animation.stop();
  }, [exit, leaving, reduced, scale]);

  return (
    <Animated.View
      pointerEvents={leaving ? 'none' : 'auto'}
      style={{ opacity: exit, transform: [{ scale }] }}
    >
      <FadeIn key={filterKey} delay={staggerDelay(index)} offset={8}>
        <Ticket
          ticket={ticketFor(flight, Date.now())}
          heading={flight.flightNumber}
          onPress={onOpen}
          onLongPress={onDelete}
        />
      </FadeIn>
    </Animated.View>
  );
}

function Gap() {
  return <View style={{ height: 12 }} />;
}

const make = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: TOOLBAR_CLEARANCE + 16 },
    header: { gap: 12, marginBottom: 12 },
    title: { color: t.ink, fontSize: 34, fontWeight: '900', paddingHorizontal: 6 },
    pills: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: FILTER_GAP,
      padding: 4,
      borderRadius: radius.round,
      backgroundColor: t.soft,
    },
    pillIndicator: {
      position: 'absolute',
      left: 4,
      top: 4,
      width: FILTER_WIDTH,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.ink,
    },
    pill: {
      width: FILTER_WIDTH,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pillText: { color: t.ink, fontSize: 15 },
    pillTextOn: { color: '#FFFFFF', fontWeight: '700' },
    empty: { color: t.muted, fontSize: 15, paddingHorizontal: 6, paddingTop: 12 },
  });
