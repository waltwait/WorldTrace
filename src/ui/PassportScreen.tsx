/**
 * Where the flying has taken you: the totals, a stamp for every country, and the
 * tickets behind each stamp. Like the fog, it counts what happened and nothing
 * else, so a flight still to come is not here at all.
 */

import { memo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { countryName, flagEmoji } from '../flights/countries';
import { airportLabel, ticketFor } from '../flights/flightDisplay';
import {
  airportCity,
  computePassportStats,
  countryStamps,
  flightsInYear,
  flownYears,
  longestFlight,
  rankAirlines,
  rankRoutes,
  timesAroundEarth,
  type CountryStamp,
} from '../flights/flightStats';
import type { FlightRecord } from '../flights/types';
import { formatFlightDistance, formatLaps } from './format';
import { Icon } from './Icon';
import { PressScale } from './PressScale';
import { Ticket } from './Ticket';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, radius, type Theme } from './themes';
import { Text } from './Text';

/** A passport keeps its lists short: the rest is in the flights themselves. */
const LIST_LENGTH = 5;

export const PassportScreen = memo(function PassportScreen({
  flights,
  visible,
  onClose,
  onOpenFlight,
}: {
  flights: FlightRecord[];
  visible: boolean;
  onClose: () => void;
  onOpenFlight: (flight: FlightRecord) => void;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const [chosenYear, setChosenYear] = useState<string | null>(null);
  const [chosenCountry, setChosenCountry] = useState<string | null>(null);

  const years = flownYears(flights);
  // The flights of a year can all be deleted while it is the one showing.
  const year = chosenYear !== null && years.includes(chosenYear) ? chosenYear : null;
  const shown = flightsInYear(flights, year);

  const stats = computePassportStats(shown);
  const stamps = countryStamps(shown);
  const airlines = rankAirlines(shown);
  const routes = rankRoutes(shown);
  const longest = longestFlight(shown);
  const laps = formatLaps(timesAroundEarth(stats.totalKm));
  const opened = stamps.find((stamp) => stamp.code === chosenCountry) ?? null;

  const yearPill = (value: string | null, label: string) => (
    <PressScale
      key={label}
      style={[styles.pill, year === value && styles.pillOn]}
      onPress={() => setChosenYear(value)}
    >
      <Text style={[styles.pillText, year === value && styles.pillTextOn]}>{label}</Text>
    </PressScale>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <PressScale style={styles.back} onPress={onClose} label="返回" hitSlop={8}>
            <Icon name="back" color={t.ink} />
          </PressScale>
          <Text style={styles.title}>飛行護照</Text>
        </View>

        {years.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.pills}>
              {yearPill(null, '全部')}
              {years.map((value) => yearPill(value, value))}
            </View>
          </ScrollView>
        ) : null}

        <View style={styles.cover}>
          <View style={styles.coverRow}>
            <Big label="航班" value={`${stats.totalFlights}`} />
            <Big label="小時" value={`${stats.totalHours}`} />
          </View>
          <Big label="距離" value={formatFlightDistance(stats.totalKm)} />
          {laps ? <Text style={styles.coverNote}>{laps}</Text> : null}
        </View>

        <View style={styles.counts}>
          <Count label="國家" value={stats.visitedCountriesCount} />
          <Count label="機場" value={stats.airportVisits.length} />
          <Count label="航空公司" value={airlines.length} />
          <Count label="航線" value={routes.length} />
        </View>

        {stats.totalFlights === 0 ? <Text style={styles.empty}>尚無已完成的飛行記錄</Text> : null}

        {stamps.length > 0 ? (
          <>
            <Text style={styles.heading}>國家</Text>
            <View style={styles.stamps}>
              {stamps.map((stamp, index) => (
                <Stamp
                  key={stamp.code}
                  stamp={stamp}
                  tilt={TILTS[index % TILTS.length]}
                  open={stamp.code === opened?.code}
                  onPress={() =>
                    setChosenCountry(stamp.code === opened?.code ? null : stamp.code)
                  }
                />
              ))}
            </View>
          </>
        ) : null}

        {opened ? (
          <View style={styles.tickets}>
            {opened.flights.map((flight) => (
              <Ticket
                key={flight.id}
                ticket={ticketFor(flight, Date.now())}
                heading={`${flight.flightNumber} ${flight.airlineName}`}
                onPress={() => onOpenFlight(flight)}
              />
            ))}
          </View>
        ) : null}

        {longest ? (
          <>
            <Text style={styles.heading}>最遠一趟</Text>
            <Ticket
              ticket={ticketFor(longest, Date.now())}
              heading={formatFlightDistance(longest.distanceKm)}
              onPress={() => onOpenFlight(longest)}
            />
          </>
        ) : null}

        <Ranking
          title="機場"
          rows={stats.airportVisits.map((visit) => ({
            name: airportLabel(airportCity(shown, visit.iata), visit.iata),
            count: visit.count,
          }))}
        />
        <Ranking title="航空公司" rows={airlines} />
        <Ranking
          title="航線"
          rows={routes.map((route) => ({
            name: `${route.from} – ${route.to}`,
            count: route.count,
          }))}
        />
      </ScrollView>
    </Modal>
  );
});

/** Stamps land by hand, never quite straight. */
const TILTS = ['-2deg', '1.5deg', '-1deg', '2deg'];

function Stamp({
  stamp,
  tilt,
  open,
  onPress,
}: {
  stamp: CountryStamp;
  tilt: string;
  open: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(make);
  const [year, month] = stamp.firstDate.split('-');

  return (
    <PressScale
      containerStyle={[styles.stampSlot, { transform: [{ rotate: tilt }] }]}
      style={[styles.stamp, open && styles.stampOpen]}
      onPress={onPress}
    >
      <Text style={styles.flag}>{flagEmoji(stamp.code)}</Text>
      <Text style={styles.stampName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {countryName(stamp.code)}
      </Text>
      <Text style={styles.stampNote}>
        {year}/{Number(month)}，{stamp.flights.length} 趟
      </Text>
    </PressScale>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  const styles = useStyles(make);
  return (
    <View style={styles.big}>
      <Text style={styles.bigValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
      <Text style={styles.coverNote}>{label}</Text>
    </View>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  const styles = useStyles(make);
  return (
    <View style={styles.count}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Ranking({
  title,
  rows,
}: {
  title: string;
  rows: ReadonlyArray<{ name: string; count: number }>;
}) {
  const styles = useStyles(make);
  if (rows.length === 0) return null;

  return (
    <>
      <Text style={styles.heading}>{title}</Text>
      <View style={styles.group}>
        {rows.slice(0, LIST_LENGTH).map((row, index) => (
          <View key={row.name} style={[styles.row, index > 0 && styles.line]}>
            <Text style={styles.rowName} numberOfLines={1}>
              {row.name}
            </Text>
            <Text style={styles.rowCount}>{row.count} 次</Text>
          </View>
        ))}
      </View>
    </>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { paddingHorizontal: 16, paddingTop: 48, paddingBottom: 32, gap: 12 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    back: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { color: t.ink, fontSize: 30, fontWeight: '900' },
    heading: { color: t.muted, fontSize: 14, paddingHorizontal: 8, marginTop: 6 },
    empty: { color: t.muted, fontSize: 15, textAlign: 'center', paddingVertical: 20 },

    pills: { flexDirection: 'row', gap: 8 },
    pill: {
      height: 38,
      paddingHorizontal: 16,
      borderRadius: radius.round,
      backgroundColor: t.soft,
      justifyContent: 'center',
    },
    pillOn: { backgroundColor: t.ink },
    pillText: { color: t.ink, fontSize: 14 },
    pillTextOn: { color: '#FFFFFF', fontWeight: '700' },

    cover: {
      paddingHorizontal: 20,
      paddingVertical: 18,
      borderRadius: radius.ticket,
      backgroundColor: t.tile,
      gap: 12,
    },
    coverRow: { flexDirection: 'row', gap: 16 },
    big: { flex: 1, minWidth: 0 },
    bigValue: { color: '#FFFFFF', fontFamily: FONT.extraBold, fontSize: 34, letterSpacing: -0.5 },
    coverNote: { color: t.onTile, fontSize: 13 },

    counts: { flexDirection: 'row', paddingHorizontal: 8 },
    count: { flex: 1, minWidth: 0 },
    countValue: { color: t.ink, fontFamily: FONT.bold, fontSize: 20 },
    countLabel: { color: t.muted, fontSize: 13 },

    stamps: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
    stampSlot: { width: '33.33%', paddingHorizontal: 5 },
    stamp: {
      paddingVertical: 12,
      paddingHorizontal: 6,
      borderRadius: 18,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: t.accent,
      alignItems: 'center',
      gap: 2,
    },
    stampOpen: { backgroundColor: t.soft, borderColor: t.tile },
    flag: { fontSize: 30 },
    stampName: { color: t.ink, fontSize: 14, fontWeight: '700' },
    stampNote: { color: t.muted, fontSize: 12 },

    tickets: { gap: 10 },

    group: { borderRadius: radius.group, backgroundColor: t.soft, overflow: 'hidden' },
    line: { borderTopWidth: 1, borderTopColor: t.ground },
    row: {
      minHeight: 46,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    rowName: { color: t.ink, fontSize: 15, flexShrink: 1 },
    rowCount: { color: t.muted, fontSize: 14 },
  });
