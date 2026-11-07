import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { autoBackUp } from './src/cloud/cloudBackup';
import type { TrackSegment } from './src/export/gpx';
import type { FlightRecord } from './src/flights/types';
import { resolvePlaces } from './src/places/resolvePlaces';
import { database } from './src/store/database';
import { AddFlightSheet } from './src/ui/AddFlightSheet';
import { DialogHost } from './src/ui/DialogHost';
import { ExploreScreen } from './src/ui/ExploreScreen';
import { FlightDetailSheet } from './src/ui/FlightDetailSheet';
import { FlightsScreen } from './src/ui/FlightsScreen';
import { openTab } from './src/ui/openedTabs';
import { OverviewScreen } from './src/ui/OverviewScreen';
import { pageAt, pagesBeside } from './src/ui/pager';
import { PassportScreen } from './src/ui/PassportScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { ThemeProvider, useTheme } from './src/ui/ThemeProvider';
import { TimelineScreen } from './src/ui/TimelineScreen';
import { TABS, Toolbar } from './src/ui/Toolbar';
import { useFlights } from './src/ui/useFlights';
import { useReducedMotion } from './src/ui/useReducedMotion';
import { useRecorder } from './src/ui/useRecorder';

/**
 * Backs up in the background when the app comes to the foreground.
 */
function useAutomaticBackup(): void {
  useEffect(() => {
    let running = false;

    async function attempt() {
      if (running) return;
      running = true;
      try {
        const driver = await database();
        await resolvePlaces(driver).catch((error) =>
          console.warn('[WorldTrace] place lookup skipped', error),
        );
        await autoBackUp(driver);
      } catch (error) {
        console.warn('[WorldTrace] automatic backup skipped', error);
      } finally {
        running = false;
      }
    }

    void attempt();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void attempt();
    });

    return () => subscription.remove();
  }, []);
}

interface Highlight {
  label: string;
  segments: TrackSegment[];
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}

function Shell() {
  const t = useTheme();
  const recorder = useRecorder();
  const flights = useFlights();
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [highlighted, setHighlighted] = useState<Highlight | null>(null);
  const [focusedFlight, setFocusedFlight] = useState<FlightRecord | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [adding, setAdding] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [explored, setExplored] = useState(false);
  const [inPassport, setInPassport] = useState(false);
  const [passportOpened, setPassportOpened] = useState(false);
  // Only the first page exists at launch; see openedTabs.ts for why the rest wait.
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set([0]));

  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  // Where a tapped tab is heading. The scroll passes the pages between on its way,
  // and each would otherwise take the toolbar with it.
  const heading = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

  useAutomaticBackup();

  const indexRef = useRef(index);
  indexRef.current = index;

  const goTo = useCallback(
    (next: number) => {
      if (next === indexRef.current) return;

      setOpened((tabs) => openTab(tabs, next));
      setIndex(next);
      heading.current = next;
      pager.current?.scrollTo({ x: next * width, animated: !reducedMotion });
    },
    [width, reducedMotion],
  );

  const onPagerScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = pageAt(event.nativeEvent.contentOffset.x, width, TABS.length);

      if (heading.current !== null) {
        if (page === heading.current) heading.current = null;
        return;
      }

      if (page !== indexRef.current) {
        setOpened((tabs) => openTab(tabs, page));
        setIndex(page);
      }
    },
    [width],
  );

  // Before the finger has gone anywhere, so the next page is there when it arrives.
  const onDragStart = useCallback(() => {
    heading.current = null;
    setOpened((tabs) =>
      pagesBeside(indexRef.current, TABS.length).reduce((all, page) => openTab(all, page), tabs),
    );
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
    setHighlighted(null);
    setFocusedFlight(null);
  }, []);

  const expand = useCallback(() => setExpanded(true), []);

  // The map is a state of the first page rather than a page of its own, so the
  // system's back gesture has to be told what it means here.
  useEffect(() => {
    if (!expanded) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      collapse();
      return true;
    });
    return () => subscription.remove();
  }, [expanded, collapse]);

  const reviewDay = useCallback(
    (label: string, segments: TrackSegment[]) => {
      setHighlighted({ label, segments });
      goTo(0);
      setExpanded(true);
    },
    [goTo],
  );

  const viewFlightOnMap = useCallback(
    (flight: FlightRecord) => {
      setFocusedFlight(flight);
      setInPassport(false);
      goTo(0);
      setExpanded(true);
    },
    [goTo],
  );

  const openFlight = useCallback((flight: FlightRecord) => {
    setSelectedId(flight.id);
    setInFlight(true);
  }, []);

  const openExplore = useCallback(() => {
    setExplored(true);
    setExploring(true);
  }, []);

  const closeExplore = useCallback(() => setExploring(false), []);

  const openPassport = useCallback(() => {
    setPassportOpened(true);
    setInPassport(true);
  }, []);

  const closePassport = useCallback(() => setInPassport(false), []);
  const openAdd = useCallback(() => setAdding(true), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  // The id stays, so the sheet still has a flight to show while it slides away.
  const closeFlight = useCallback(() => setInFlight(false), []);

  // Looked up by id on every render, so a change made elsewhere shows at once.
  const selected = flights.flights.find((flight) => flight.id === selectedId) ?? null;

  const pageSize = { width };
  const covered = adding || exploring || inPassport || inFlight;

  return (
    <View style={[styles.container, { backgroundColor: t.ground }]}>
      <StatusBar style="dark" />

      {/* A native scroll view rather than a gesture in JS: redrawing the fog holds
          the JS thread for seconds, and a swipe has to follow the finger through
          that. Pages are never unmounted, which keeps MapLibre's map alive. With
          the map open the drag belongs to the map. */}
      <ScrollView
        ref={pager}
        style={styles.screens}
        horizontal
        pagingEnabled
        scrollEnabled={!expanded}
        showsHorizontalScrollIndicator={false}
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={onPagerScroll}
        onScrollBeginDrag={onDragStart}
      >
        <View style={pageSize}>
          <OverviewScreen
            recorder={recorder}
            flights={flights.flights}
            highlighted={highlighted}
            focusedFlight={focusedFlight}
            expanded={expanded}
            active={index === 0 && !covered}
            onCollapse={collapse}
            onExpand={expand}
            onOpenExplore={openExplore}
            onOpenFlight={openFlight}
            onAdd={openAdd}
            onOpenPassport={openPassport}
          />
        </View>
        <View style={pageSize}>
          {opened.has(1) ? <TimelineScreen onSelectDay={reviewDay} active={index === 1} /> : null}
        </View>
        <View style={pageSize}>
          {opened.has(2) ? (
            <FlightsScreen state={flights} onOpenFlight={openFlight} />
          ) : null}
        </View>
        <View style={pageSize}>{opened.has(3) ? <SettingsScreen /> : null}</View>
      </ScrollView>

      {expanded ? null : <Toolbar active={index} onSelect={goTo} onAdd={openAdd} />}

      {passportOpened ? (
        <PassportScreen
          flights={flights.flights}
          visible={inPassport}
          onClose={closePassport}
          onOpenFlight={openFlight}
        />
      ) : null}

      {selected ? (
        <FlightDetailSheet
          key={selected.id}
          flight={selected}
          visible={inFlight}
          onClose={closeFlight}
          onFlightUpdated={flights.updated}
          onFlightDeleted={flights.removed}
          onViewOnMap={viewFlightOnMap}
        />
      ) : null}

      <AddFlightSheet visible={adding} onClose={closeAdd} onFlightAdded={flights.added} />

      {explored ? (
        <ExploreScreen
          recorder={recorder}
          visible={exploring}
          onClose={closeExplore}
        />
      ) : null}

      {/* Mounted once, at the root: anything in the app can ask a question
          without every screen in between having to pass a handler down. */}
      <DialogHost />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screens: { flex: 1 },
});
