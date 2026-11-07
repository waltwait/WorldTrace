/**
 * The first page: the map, what it adds up to, and a flight.
 *
 * The tile opens by changing the style of the view around the map, not by swapping
 * views: a new view would tear down MapLibre's native map and start the fog again.
 * The map inside keeps the size of the screen throughout; see mapCrop.ts. Nothing
 * here scrolls, since a view inside a scroll view cannot grow past it; the tile
 * takes whatever height the rest leaves, so a small phone gets a smaller map rather
 * than a clipped page.
 * The wallet is always there, or the map would take its place and fill the screen.
 */

import { memo, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { ticketFor, walletFlight } from '../flights/flightDisplay';
import type { FlightRecord } from '../flights/types';
import { formatEarthShare } from './earth';
import { FogMap, MapCredit, RecordingStatus, type FogMapProps } from './FogMap';
import { formatArea, formatDistance } from './format';
import { cropOffset, steadySize, type Size } from './mapCrop';
import { CURVE, DURATION } from './motion';
import { PassportCard } from './PassportCard';
import { PressScale } from './PressScale';
import { RollingNumber } from './RollingNumber';
import { Ticket } from './Ticket';
import { useStyles } from './ThemeProvider';
import { FONT, radius, TOOLBAR_CLEARANCE, type Theme } from './themes';
import { useReducedMotion } from './useReducedMotion';
import { Text } from './Text';

export const OverviewScreen = memo(function OverviewScreen({
  onExpand,
  onOpenExplore,
  onOpenFlight,
  onAdd,
  onOpenPassport,
  ...map
}: FogMapProps & {
  onExpand: () => void;
  onOpenExplore: () => void;
  onOpenFlight: (flight: FlightRecord) => void;
  onAdd: () => void;
  onOpenPassport: () => void;
}) {
  const styles = useStyles(make);
  const reduced = useReducedMotion();
  const { recorder, flights, expanded } = map;
  const shown = walletFlight(flights, Date.now());
  const window = useWindowDimensions();
  const [page, setPage] = useState<Size>({ width: window.width, height: window.height });
  const [tile, setTile] = useState<Size>(page);
  const pageMeasured = useRef(false);
  const wasExpanded = useRef(expanded);
  const chrome = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const returning = !expanded && wasExpanded.current;
    wasExpanded.current = expanded;
    if (!returning) return;

    if (reduced) {
      chrome.setValue(1);
      return;
    }

    chrome.setValue(0);
    const animation = Animated.timing(chrome, {
      toValue: 1,
      duration: DURATION.enter,
      easing: Easing.bezier(...CURVE.enter),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [chrome, expanded, reduced]);

  const sizeOf = (event: LayoutChangeEvent): Size => ({
    width: event.nativeEvent.layout.width,
    height: event.nativeEvent.layout.height,
  });

  const chromeShift = chrome.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  return (
    <View style={styles.screen} onLayout={(event) => {
        // The first report is the truth: `window` can be taller than the page.
        const next = sizeOf(event);
        setPage((current) => (pageMeasured.current ? steadySize(current, next) : next));
        pageMeasured.current = true;
      }}
    >
      <View
        style={expanded ? styles.mapOpen : styles.mapTile}
        onLayout={(event) => {
          if (!expanded) setTile(sizeOf(event));
        }}
      >
        <View style={[styles.map, page, expanded ? styles.mapAtOrigin : cropOffset(tile, page)]}>
          <FogMap {...map} />
        </View>

        {expanded ? null : (
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onExpand}
              accessibilityRole="button"
              accessibilityLabel="打開地圖"
            />
            <MapCredit expanded={false} />
            {recorder.status !== 'recording' ? (
              <View style={styles.tileStatus}>
                <RecordingStatus recorder={recorder} />
              </View>
            ) : null}
            <Animated.View style={[styles.areaChip, { opacity: chrome }]} pointerEvents="none">
              <RollingNumber
                value={recorder.exploredSquareMeters}
                format={formatArea}
                run={0}
                style={styles.area}
                fit
              />
            </Animated.View>
          </>
        )}
      </View>

      {expanded ? null : (
        <Animated.View
          style={[
            styles.chrome,
            {
              opacity: chrome,
              transform: [{ translateY: chromeShift }],
            },
          ]}
        >
          <PressScale style={styles.facts} onPress={onOpenExplore}>
            <Text style={styles.fact}>
              走過 <Text style={styles.factValue}>{formatDistance(recorder.distanceMeters)}</Text>
            </Text>
            <Text style={styles.fact} numberOfLines={1}>
              地球的{' '}
              <Text style={styles.factShare}>
                {formatEarthShare(recorder.exploredSquareMeters)}
              </Text>
            </Text>
          </PressScale>

          <PassportCard flights={flights} onOpen={onOpenPassport} />

          <View style={styles.wallet}>
            <View style={styles.cardBehindFar} />
            <View style={styles.cardBehind} />
            <View style={styles.cardFront}>
              {shown ? (
                <Ticket
                  ticket={ticketFor(shown.flight, Date.now())}
                  heading={`${shown.label} ${shown.flight.flightNumber}`}
                  onPress={() => onOpenFlight(shown.flight)}
                />
              ) : (
                <PressScale style={styles.noTicket} onPress={onAdd}>
                  <Text style={styles.noTicketText}>新增航班</Text>
                </PressScale>
              )}
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
});

const make = (t: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.ground,
      paddingTop: 44,
      paddingHorizontal: 16,
      paddingBottom: TOOLBAR_CLEARANCE,
      gap: 12,
    },
    mapTile: { flex: 1, borderRadius: radius.map, overflow: 'hidden', backgroundColor: t.tile },
    mapOpen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
    map: { position: 'absolute' },
    mapAtOrigin: { left: 0, top: 0 },
    tileStatus: { position: 'absolute', left: 14, top: 12, right: 14 },

    areaChip: {
      position: 'absolute',
      left: 18,
      bottom: 14,
      right: 18,
      alignItems: 'flex-start',
    },
    area: {
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: 8,
      borderRadius: 24,
      overflow: 'hidden',
      backgroundColor: t.tile,
      color: '#FFFFFF',
      fontFamily: FONT.extraBold,
      fontSize: 34,
      letterSpacing: -1,
    },

    chrome: { gap: 12 },
    facts: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 16,
      paddingHorizontal: 8,
      minHeight: 28,
      alignItems: 'center',
    },
    fact: { color: t.muted, fontSize: 15, flexShrink: 1 },
    factValue: { color: t.ink, fontFamily: FONT.bold },
    // Mostly Chinese, 「513 萬分之一」, so it stays in the same type as its words.
    factShare: { color: t.ink, fontWeight: '700' },

    // Two more tickets edge-on behind the front one, as in a wallet.
    wallet: { height: 158 },
    cardBehindFar: {
      position: 'absolute',
      left: 18,
      right: 18,
      top: 0,
      height: 60,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: t.soft,
    },
    cardBehind: {
      position: 'absolute',
      left: 9,
      right: 9,
      top: 12,
      height: 60,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: t.accent,
    },
    cardFront: { position: 'absolute', left: 0, right: 0, top: 26 },
    noTicket: {
      height: 132,
      borderRadius: radius.ticket,
      backgroundColor: t.tile,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noTicketText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  });
