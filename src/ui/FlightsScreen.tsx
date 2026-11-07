import { memo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { pastFlights, ticketFor, upcomingFlights } from '../flights/flightDisplay';
import type { FlightRecord } from '../flights/types';
import { PressScale } from './PressScale';
import { Ticket } from './Ticket';
import { useStyles, useTheme } from './ThemeProvider';
import { radius, TOOLBAR_CLEARANCE, type Theme } from './themes';
import type { FlightsState } from './useFlights';
import { Text } from './Text';

export const FlightsScreen = memo(function FlightsScreen({
  state,
  onOpenFlight,
}: {
  state: FlightsState;
  onOpenFlight: (flight: FlightRecord) => void;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const [filter, setFilter] = useState<'active' | 'finished'>('active');
  const { flights, loading, refreshing, failed, pullToRefresh } = state;

  const shown = filter === 'active' ? upcomingFlights(flights) : pastFlights(flights);

  const pill = (value: typeof filter, label: string) => (
    <PressScale
      style={[styles.pill, filter === value && styles.pillOn]}
      onPress={() => setFilter(value)}
    >
      <Text style={[styles.pillText, filter === value && styles.pillTextOn]}>{label}</Text>
    </PressScale>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={shown}
      keyExtractor={(flight) => flight.id}
      ItemSeparatorComponent={Gap}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} tintColor={t.muted} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>航班</Text>
          <View style={styles.pills}>
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
      renderItem={({ item }) => (
        <Ticket
          ticket={ticketFor(item, Date.now())}
          heading={item.flightNumber}
          onPress={() => onOpenFlight(item)}
        />
      )}
    />
  );
});

function Gap() {
  return <View style={{ height: 12 }} />;
}

const make = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: TOOLBAR_CLEARANCE + 16 },
    header: { gap: 12, marginBottom: 12 },
    title: { color: t.ink, fontSize: 34, fontWeight: '900', paddingHorizontal: 6 },
    pills: { flexDirection: 'row', gap: 8 },
    pill: {
      height: 44,
      paddingHorizontal: 20,
      borderRadius: radius.round,
      backgroundColor: t.soft,
      justifyContent: 'center',
    },
    pillOn: { backgroundColor: t.ink },
    pillText: { color: t.ink, fontSize: 15 },
    pillTextOn: { color: '#FFFFFF', fontWeight: '700' },
    empty: { color: t.muted, fontSize: 15, paddingHorizontal: 6, paddingTop: 12 },
  });
