/**
 * Where the flying has taken you: a cover with the totals and the flags of where it
 * went, then three pages side by side, swiped or chosen by name: the trips, a stamp
 * for every country, and the rankings. Like the fog, it counts what happened and
 * nothing else, so a flight still to come is not here at all.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { countryName, flagEmoji } from '../flights/countries';
import { airportLabel, ticketFor } from '../flights/flightDisplay';
import {
  airportCity,
  computePassportStats,
  countryStamps,
  longestFlight,
  rankAirlines,
  rankRoutes,
  type CountryStamp,
} from '../flights/flightStats';
import { linksOfTrip } from '../flights/tripLinks';
import { passportTrips, yearChoices, type PassportTrip } from '../flights/trips';
import type { FlightRecord } from '../flights/types';
import { FadeIn } from './FadeIn';
import { formatWholeKm } from './format';
import { useHomeCountry } from './HomeCountry';
import { FullScreenModal } from './FullScreenModal';
import { staggerDelay } from './motion';
import { PressScale } from './PressScale';
import { SwapText } from './SwapText';
import { Ticket } from './Ticket';
import { useStyles } from './ThemeProvider';
import { FONT, radius, type Theme } from './themes';
import { Text } from './Text';
import { ShareCardSheet } from './ShareCardSheet';
import { SheetHeader } from './SheetHeader';
import { TripCard } from './TripCard';
import { TripScreen } from './TripScreen';
import { useFlightLinks } from './useFlightLinks';
import { pageAt } from './pager';
import { SectionTabs } from './SectionTabs';
import { useReducedMotion } from './useReducedMotion';
import { YearButton, YearPicker } from './YearPicker';

const SECTIONS = ['旅程', '國家', '排行'] as const;

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
  const reduced = useReducedMotion();
  const [chosenYear, setChosenYear] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [section, setSection] = useState(0);
  const [pagerWidth, setPagerWidth] = useState(0);
  // Each page is as tall as it is: the pager takes the height of the one showing.
  const [pageHeights, setPageHeights] = useState<number[]>([0, 0, 0]);
  const [openTrips, setOpenTrips] = useState<ReadonlySet<string>>(() => new Set());
  const pager = useRef<ScrollView>(null);
  // The names above the pages follow this as the finger moves.
  const scrollX = useRef(new Animated.Value(0)).current;
  const [chosenCountry, setChosenCountry] = useState<string | null>(null);
  const [yearChanges, setYearChanges] = useState(0);
  // A flight of the trip opened: its first can be deleted, or another flight join it.
  const [tripFlightId, setTripFlightId] = useState<string | null>(null);
  const [inTrip, setInTrip] = useState(false);
  const [sharing, setSharing] = useState(false);
  const lastTrip = useRef<PassportTrip | null>(null);
  const { links, add: addLink, remove: removeLink } = useFlightLinks(flights);

  useEffect(() => {
    if (visible) return;
    setYearChanges(0);
    // The passport can be closed under it, by 在地圖上看 on a flight opened from it.
    setInTrip(false);
    setSharing(false);
    setPicking(false);
    // The pages are unmounted with it and come back on the first one.
    setSection(0);
    scrollX.setValue(0);
  }, [scrollX, visible]);

  const showSection = useCallback(
    (index: number) => {
      setSection(index);
      pager.current?.scrollTo({ x: index * pagerWidth, animated: !reduced });
    },
    [pagerWidth, reduced],
  );

  const measurePage = (index: number) => (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setPageHeights((heights) =>
      Math.abs(heights[index] - height) < 1 ? heights : heights.map((h, i) => (i === index ? height : h)),
    );
  };

  const toggleTrip = (key: string) =>
    setOpenTrips((open) => {
      const next = new Set(open);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { home } = useHomeCountry();
  const allTrips = passportTrips(flights, home, null);
  const choices = yearChoices(flights, home);
  // The flights of a year can all be deleted while it is the one showing.
  const year = choices.some((choice) => choice.year === chosenYear) ? chosenYear : null;
  const trips = passportTrips(flights, home, year);
  const shown = year === null ? flights : trips.flatMap((trip) => trip.flights);

  const stats = computePassportStats(shown, home);
  const stamps = countryStamps(shown, home);
  const airlines = rankAirlines(shown);
  const routes = rankRoutes(shown);
  const longest = longestFlight(shown);
  const opened = stamps.find((stamp) => stamp.code === chosenCountry) ?? null;
  const flags = stamps.map((stamp) => flagEmoji(stamp.code)).filter(Boolean);

  // Found among every year's, so choosing another year underneath does not lose it.
  const openTrip =
    tripFlightId === null
      ? null
      : (allTrips.find((trip) => trip.flights.some((flight) => flight.id === tripFlightId)) ?? null);
  // Kept, so the page still has a trip to show while it slides away.
  if (openTrip) lastTrip.current = openTrip;
  const shownTrip = openTrip ?? lastTrip.current;

  const chooseYear = (value: string | null) => {
    if (value !== year) setYearChanges((n) => n + 1);
    setChosenYear(value);
    setPicking(false);
  };
  const closePicker = useCallback(() => setPicking(false), []);

  return (
    <>
    <FullScreenModal visible={visible} onRequestClose={onClose}>
      <View style={styles.screen}>
      <SheetHeader
        title="飛行護照"
        onBack={onClose}
        accessory={
          choices.length > 1 ? (
            <YearButton label={year ?? 'ALL'} onPress={() => setPicking(true)} />
          ) : undefined
        }
        action={
          stats.totalFlights > 0
            ? { icon: 'share', label: '匯出圖片', onPress: () => setSharing(true) }
            : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.cover}>
          <View style={styles.coverRow}>
            <Big label="航班" value={`${stats.totalFlights}`} />
            <Big label="小時" value={`${stats.totalHours}`} />
          </View>
          <Big label="距離" value={formatWholeKm(stats.totalKm)} />
          {flags.length > 0 ? (
            <View style={styles.flags}>
              {flags.map((flag, index) => (
                <Text key={index} style={styles.coverFlag}>
                  {flag}
                </Text>
              ))}
            </View>
          ) : null}
          <View style={styles.counts}>
            <Count label="機場" value={stats.airportVisits.length} />
            <Count label="航空公司" value={airlines.length} />
            <Count label="航線" value={routes.length} />
          </View>
        </View>

        {stats.totalFlights === 0 ? (
          <Text style={styles.empty}>尚無已完成的飛行記錄</Text>
        ) : (
          <>
            <SectionTabs names={SECTIONS} scrollX={scrollX} width={pagerWidth} onSelect={showSection} />

            <View onLayout={(event) => setPagerWidth(event.nativeEvent.layout.width)}>
              {/* Laid out once its width is known, or every page is measured at none. */}
              {pagerWidth > 0 ? (
              <Animated.ScrollView
                ref={pager}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                scrollEventThrottle={16}
                onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
                  useNativeDriver: true,
                })}
                style={pageHeights[section] > 0 ? { height: pageHeights[section] } : undefined}
                contentContainerStyle={styles.pages}
                onMomentumScrollEnd={(event) =>
                  setSection(pageAt(event.nativeEvent.contentOffset.x, pagerWidth, SECTIONS.length))
                }
              >
                <View style={[styles.page, { width: pagerWidth }]} onLayout={measurePage(0)}>
                  {trips.map((trip) => (
                    <TripCard
                      key={trip.key}
                      trip={trip}
                      year={year}
                      linkCount={linksOfTrip(links, trip).length}
                      open={openTrips.has(trip.key)}
                      onToggle={() => toggleTrip(trip.key)}
                      onOpen={() => {
                        setTripFlightId(trip.key);
                        setInTrip(true);
                      }}
                      onOpenFlight={onOpenFlight}
                    />
                  ))}
                </View>

                <View style={[styles.page, { width: pagerWidth }]} onLayout={measurePage(1)}>
                  <View style={styles.stamps}>
                    {stamps.map((stamp, index) => (
                      <Stamp
                        key={stamp.code}
                        stamp={stamp}
                        index={index}
                        yearKey={`${year ?? 'all'}-${yearChanges}`}
                        animate={yearChanges > 0}
                        tilt={TILTS[index % TILTS.length]}
                        open={stamp.code === opened?.code}
                        onPress={() =>
                          setChosenCountry(stamp.code === opened?.code ? null : stamp.code)
                        }
                      />
                    ))}
                  </View>
                  {opened ? (
                    <FadeIn key={opened.code} offset={8} style={styles.tickets}>
                      {opened.flights.map((flight) => (
                        <Ticket
                          key={flight.id}
                          ticket={ticketFor(flight, Date.now())}
                          heading={`${flight.flightNumber} ${flight.airlineName}`}
                          onPress={() => onOpenFlight(flight)}
                        />
                      ))}
                    </FadeIn>
                  ) : null}
                </View>

                <View style={[styles.page, { width: pagerWidth }]} onLayout={measurePage(2)}>
                  {longest ? (
                    <>
                      <Text style={styles.heading}>最遠一趟</Text>
                      <Ticket
                        ticket={ticketFor(longest, Date.now())}
                        heading={formatWholeKm(longest.distanceKm)}
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
                </View>
              </Animated.ScrollView>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      <YearPicker
        choices={choices}
        chosen={year}
        visible={picking}
        onChoose={chooseYear}
        onClose={closePicker}
      />
      </View>
    </FullScreenModal>

    {shownTrip ? (
      <TripScreen
        trip={shownTrip}
        links={linksOfTrip(links, shownTrip)}
        visible={inTrip && openTrip !== null}
        onClose={() => setInTrip(false)}
        onOpenFlight={onOpenFlight}
        onAddLink={addLink}
        onRemoveLink={removeLink}
      />
    ) : null}

    <ShareCardSheet
      target={stats.totalFlights > 0 ? { kind: 'year', flights, year } : null}
      visible={visible && sharing}
      onClose={() => setSharing(false)}
    />
    </>
  );
});

/** Stamps land by hand, never quite straight. */
const TILTS = ['-2deg', '1.5deg', '-1deg', '2deg'];

function Stamp({
  stamp,
  index,
  yearKey,
  animate,
  tilt,
  open,
  onPress,
}: {
  stamp: CountryStamp;
  index: number;
  yearKey: string;
  animate: boolean;
  tilt: string;
  open: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(make);
  const [year, month] = stamp.firstDate.split('-');

  const body = (
    <PressScale style={[styles.stamp, open && styles.stampOpen]} onPress={onPress}>
      <Text style={styles.flag}>{flagEmoji(stamp.code)}</Text>
      <Text
        style={styles.stampName}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {countryName(stamp.code)}
      </Text>
      <Text style={styles.stampNote}>
        {year}/{Number(month)}，{stamp.trips} 趟
      </Text>
    </PressScale>
  );

  return (
    <View style={[styles.stampSlot, { transform: [{ rotate: tilt }] }]}>
      {animate ? (
        <FadeIn key={yearKey} delay={staggerDelay(index)} pop offset={6}>
          {body}
        </FadeIn>
      ) : (
        body
      )}
    </View>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  const styles = useStyles(make);
  return (
    <View style={styles.big}>
      <SwapText
        text={value}
        style={styles.bigValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      />
      <Text style={styles.coverNote}>{label}</Text>
    </View>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  const styles = useStyles(make);
  return (
    <View style={styles.count}>
      <SwapText text={`${value}`} style={styles.countValue} />
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
        {/* All of them: a count above that the list did not reach looked like a wrong count. */}
        {rows.map((row, index) => (
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
    content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32, gap: 12 },
    heading: { color: t.muted, fontSize: 14, paddingHorizontal: 8, marginTop: 6 },
    empty: { color: t.muted, fontSize: 15, textAlign: 'center', paddingVertical: 20 },

    pages: { alignItems: 'flex-start' },
    page: { gap: 12 },

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
    flags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    coverFlag: { fontSize: 26 },

    counts: { flexDirection: 'row', paddingTop: 12, borderTopWidth: 1, borderTopColor: t.accent },
    count: { flex: 1, minWidth: 0 },
    countValue: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 20 },
    countLabel: { color: t.onTile, fontSize: 13 },

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
