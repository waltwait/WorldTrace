/**
 * One trip on the passport: where it went and when, and its route. A tap opens it out
 * to its tickets and the way into the trip's page; a ticket opens its flight.
 */

import { StyleSheet, View } from 'react-native';
import { ticketFor } from '../flights/flightDisplay';
import { routeChain, tripDates, type PassportTrip } from '../flights/trips';
import type { FlightRecord } from '../flights/types';
import { FadeIn } from './FadeIn';
import { Icon } from './Icon';
import { PressScale } from './PressScale';
import { RouteLine } from './RouteLine';
import { Text } from './Text';
import { Ticket } from './Ticket';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, radius, type Theme } from './themes';

export function TripCard({
  trip,
  year,
  linkCount,
  open,
  onToggle,
  onOpen,
  onOpenFlight,
}: {
  trip: PassportTrip;
  year: string | null;
  linkCount: number;
  /** Showing its tickets. */
  open: boolean;
  onToggle: () => void;
  /** Into the trip's own page, where its links are. */
  onOpen: () => void;
  onOpenFlight: (flight: FlightRecord) => void;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const now = Date.now();

  return (
    <View style={styles.block}>
      <PressScale style={styles.top} onPress={onToggle}>
        <View style={styles.head}>
          {trip.code ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{trip.code}</Text>
            </View>
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {trip.title}
          </Text>
          <Text style={styles.dates} numberOfLines={1}>
            {tripDates(trip, year)}
          </Text>
          {linkCount > 0 ? (
            <View style={styles.links}>
              <Icon name="link" color={t.muted} size={14} />
              <Text style={styles.linkCount}>{linkCount}</Text>
            </View>
          ) : null}
          <View style={open && styles.turned}>
            <Icon name="chevronDown" color={t.ink} size={18} />
          </View>
        </View>
        <RouteLine steps={routeChain(trip.flights)} />
      </PressScale>

      {open ? (
        <FadeIn offset={6} style={styles.opened}>
          {trip.flights.map((flight) => {
            const ticket = ticketFor(flight, now);
            return (
              <Ticket
                key={flight.id}
                small
                ticket={ticket}
                heading={`${ticket.when}，${flight.flightNumber}`}
                onPress={() => onOpenFlight(flight)}
              />
            );
          })}
          <PressScale style={styles.page} onPress={onOpen}>
            <Text style={styles.pageText}>旅程頁</Text>
            <Icon name="chevronRight" color={t.muted} size={18} />
          </PressScale>
        </FadeIn>
      ) : null}
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    block: { padding: 12, borderRadius: radius.group, backgroundColor: t.soft, gap: 10 },
    top: { gap: 10 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
    chip: {
      minWidth: 30,
      height: 22,
      paddingHorizontal: 6,
      borderRadius: 6,
      backgroundColor: t.tile,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 12 },
    title: { flexShrink: 1, color: t.ink, fontSize: 17, fontWeight: '700' },
    dates: { marginLeft: 'auto', color: t.muted, fontSize: 13 },
    links: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    linkCount: { color: t.muted, fontFamily: FONT.bold, fontSize: 12 },
    turned: { transform: [{ rotate: '180deg' }] },
    opened: { gap: 10 },
    page: {
      height: 44,
      paddingHorizontal: 6,
      borderTopWidth: 1,
      borderTopColor: t.ground,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    pageText: { color: t.ink, fontSize: 15 },
  });
