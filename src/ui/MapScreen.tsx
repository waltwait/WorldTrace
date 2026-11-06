import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  UserLocation,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { TrackSegment } from '../export/gpx';
import { findAirport } from '../flights/airports';
import { buildFlightArcsGeoJson, buildGreatCircleArc, routesKey } from '../flights/greatCircle';
import { routeCamera } from '../flights/routeCamera';
import type { FlightRecord } from '../flights/types';
import { database } from '../store/database';
import { listFlights } from '../store/flights';
import { compareToLandmark, formatEarthShare } from './earth';
import { FadeIn } from './FadeIn';
import { DURATION } from './motion';
import { formatArea, formatDistance } from './format';
import { PressScale } from './PressScale';
import { RollingNumber } from './RollingNumber';
import { SwapText } from './SwapText';
import { radius, theme } from './theme';
import { useFog } from './useFog';
import type { RecorderState } from './useRecorder';

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const INITIAL_CENTER: [number, number] = [121.5654, 25.033];

export interface MapScreenProps {
  recorder: RecorderState;
  /** A past day being reviewed, drawn over the fog. */
  highlighted: { label: string; segments: TrackSegment[] } | null;
  onClearHighlight: () => void;
  focusedFlight?: FlightRecord | null;
  onClearFocusedFlight?: () => void;
  /** Whether the map is the page on screen; flights are re-read on arrival. */
  active?: boolean;
}

export const MapScreen = memo(function MapScreen({
  recorder,
  highlighted,
  onClearHighlight,
  focusedFlight,
  onClearFocusedFlight,
  active = true,
}: MapScreenProps) {
  const [mapLayerMode, setMapLayerMode] = useState<'all' | 'fog' | 'flights'>('all');
  const [flights, setFlights] = useState<FlightRecord[]>([]);
  const cameraRef = useRef<CameraRef>(null);
  const { width, height } = useWindowDimensions();

  // The map stays mounted, so reading flights once at mount meant a flight
  // added on the Trips page never got an arc, and a deleted one kept its arc,
  // until the app restarted. Read them each time the map comes into view.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const db = await database();
        const all = await listFlights(db);
        if (!cancelled) setFlights(all);
      } catch {
        // Ignore background fetch error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!focusedFlight) return;
    if (mapLayerMode === 'fog') {
      setMapLayerMode('all');
    }
    const dep = findAirport(focusedFlight.depIata);
    const arr = findAirport(focusedFlight.arrIata);
    if (dep && arr) {
      // Framed from the arc itself, the short way round: a box from the two
      // airports' smallest to largest longitude framed TPE→LAX on Africa.
      const route = buildGreatCircleArc(dep, arr, 40);
      const padding = { top: 120, bottom: 140, left: 60, right: 60 };
      const { center, zoom } = routeCamera(route, { width, height }, padding);
      cameraRef.current?.easeTo({ center, zoom, padding, duration: 1200 });
    }
  }, [focusedFlight]);

  // A string, made once per change of route: GeoJSONSource stringifies an
  // object on every render (see useFog).
  const arcsKey = routesKey(flights);
  const flightArcs = useMemo(() => {
    const arcs = buildFlightArcsGeoJson(flights);
    return arcs.features.length > 0 ? JSON.stringify(arcs) : null;
  }, [arcsKey]);

  const trackLines = useMemo(() => {
    if (!highlighted) return null;

    const coordinates = highlighted.segments
      .filter((segment) => segment.points.length > 1)
      .map((segment) => segment.points.map((p) => [p.lon, p.lat]));

    if (coordinates.length === 0) return null;

    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'MultiLineString' as const, coordinates },
    };
  }, [highlighted]);

  const landmark = compareToLandmark(recorder.exploredSquareMeters);

  // The fog is built for what the map is showing, so the map has to say what
  // that is: while it moves (see useFog), when it settles after a move, and once
  // when it first loads, since nothing moves a map that is already where the
  // user is.
  const { fog, onMapView, onMapMoving } = useFog(recorder.tiles);
  const mapRef = useRef<MapRef>(null);
  const reportView = useCallback(async () => {
    try {
      const state = await mapRef.current?.getViewState();
      if (state) onMapView(state);
    } catch {
      // Not ready yet; the region event that follows will say.
    }
  }, [onMapView]);

  return (
    <View style={styles.container}>
      {/* androidView="texture": v11 switched Android to GLSurfaceView by
          default, which renders the map horizontally mirrored on this device.
          TextureView is the documented fallback. */}
      <Map
        ref={mapRef}
        style={styles.map}
        mapStyle={OSM_STYLE}
        logo={false}
        attribution={false}
        androidView="texture"
        onRegionIsChanging={(event) => onMapMoving(event.nativeEvent)}
        onRegionDidChange={(event) => onMapView(event.nativeEvent)}
        onDidFinishLoadingMap={() => void reportView()}
      >
        {/* "default" follows your position but never touches the bearing, so
            north stays up. "course" and "heading" both spin the map under you,
            which makes a fog map much harder to read — you lose track of which
            way the cleared ground runs. Rotating by hand still works. */}
        <Camera
          ref={cameraRef}
          initialViewState={{ center: INITIAL_CENTER, zoom: 15, bearing: 0 }}
          trackUserLocation={highlighted || focusedFlight ? undefined : 'default'}
          maxZoom={18}
        />
        <UserLocation />

        {/* maxzoom matches the camera's own limit. Stopping fog tiles at 11 and
            drawing them enlarged beyond it was tried and did nothing for the
            flash of unfogged map on a fast zoom out; see CLAUDE.md.
            tolerance=0 prevents Douglas-Peucker simplification from collapsing holes.

            fill-antialias is off because the fog is cut into many neighbouring
            polygons (see fog/fogPartition.ts). Antialiasing draws a line along
            every polygon edge in the fill's own translucent colour, so two
            polygons sharing an edge would draw it twice, darker, as a seam. */}
        {mapLayerMode !== 'flights' ? (
          <GeoJSONSource id="fog" data={fog} maxzoom={18} tolerance={0}>
            <Layer
              id="fog-fill"
              type="fill"
              paint={{
                'fill-color': theme.fog,
                'fill-opacity': theme.fogOpacity,
                'fill-antialias': false,
              }}
            />
          </GeoJSONSource>
        ) : null}

        {flightArcs && mapLayerMode !== 'fog' ? (
          <GeoJSONSource id="flight-arcs" data={flightArcs} maxzoom={18}>
            <Layer
              id="flight-arcs-outer"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': theme.flightArcOuter,
                'line-width': 5,
                'line-opacity': 0.6,
              }}
            />
            <Layer
              id="flight-arcs-inner"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': theme.flightArcInner,
                'line-width': 2.5,
                'line-opacity': 0.95,
              }}
            />
          </GeoJSONSource>
        ) : null}

        {trackLines ? (
          <GeoJSONSource id="day-track" data={trackLines} maxzoom={18}>
            <Layer
              id="day-track-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': theme.trackLine, 'line-width': 4, 'line-opacity': 0.9 }}
            />
          </GeoJSONSource>
        ) : null}
      </Map>

      {/* Layer Mode Selector: All (雙層) | Fog (迷霧) | Flights (航線) */}
      <View style={styles.layerSelector}>
        {(['all', 'fog', 'flights'] as const).map((mode) => (
          <PressScale
            key={mode}
            style={[styles.layerBtn, mapLayerMode === mode && styles.layerBtnActive]}
            onPress={() => setMapLayerMode(mode)}
          >
            <Text
              style={[
                styles.layerBtnText,
                mapLayerMode === mode && styles.layerBtnTextActive,
              ]}
            >
              {mode === 'all' ? '雙層' : mode === 'fog' ? '迷霧' : '航線'}
            </Text>
          </PressScale>
        ))}
      </View>

      {focusedFlight ? (
        <FadeIn
          key={focusedFlight.id}
          style={styles.highlightAnchor}
          offset={-8}
          delay={DURATION.page}
        >
          <PressScale style={styles.highlightBanner} onPress={onClearFocusedFlight}>
            <Text style={styles.highlightText}>
              ✈️ {focusedFlight.flightNumber} · {focusedFlight.depIata} → {focusedFlight.arrIata}
            </Text>
            <Text style={styles.highlightDismiss}>返回即時 ✕</Text>
          </PressScale>
        </FadeIn>
      ) : null}

      {highlighted ? (
        // Keyed on the day so picking another one plays the entrance again.
        // Delayed past the page slide: one thing moves at a time.
        <FadeIn
          key={highlighted.label}
          style={styles.highlightAnchor}
          offset={-8}
          delay={DURATION.page}
        >
          <PressScale style={styles.highlightBanner} onPress={onClearHighlight}>
            <Text style={styles.highlightText}>{highlighted.label} 的軌跡</Text>
            <Text style={styles.highlightDismiss}>返回即時 ✕</Text>
          </PressScale>
        </FadeIn>
      ) : null}

      <View style={styles.panel}>
        <StatusPill state={recorder} />

        <View style={styles.stats}>
          <View style={styles.primary}>
            <RollingNumber
              value={recorder.exploredSquareMeters}
              format={formatArea}
              run={0}
              style={styles.primaryValue}
              fit
            />
            <Text style={styles.label}>已探索</Text>
          </View>
          <View style={styles.secondary}>
            <RollingNumber
              value={recorder.distanceMeters}
              format={formatDistance}
              run={0}
              style={styles.secondaryValue}
            />
            <Text style={styles.label}>走過</Text>
          </View>
        </View>

        <SwapText
          text={`佔地球表面 ${formatEarthShare(recorder.exploredSquareMeters)}${
            landmark ? `　·　${landmark}` : ''
          }`}
          style={styles.earth}
        />

        {/* The native attribution button was turned off because its dialog
            covered the map. OpenStreetMap's tile policy still requires a
            visible credit, so it moves here. */}
        <Text style={styles.credit}>© OpenStreetMap contributors</Text>
      </View>
    </View>
  );
});

function StatusPill({ state }: { state: RecorderState }) {
  if (state.status === 'recording') {
    return (
      <View style={styles.pill}>
        <View style={styles.liveDot} />
        <Text style={styles.pillText}>記錄中</Text>
      </View>
    );
  }

  const message =
    state.status === 'starting'
      ? '啟動中…'
      : state.status === 'denied'
        ? '需要「一律允許」定位權限'
        : '無法開始記錄';

  return (
    <View style={styles.pillProblem}>
      <Text style={styles.pillProblemText}>{message}</Text>
      {state.error && state.status === 'failed' ? (
        <Text style={styles.errorDetail} numberOfLines={2}>
          {state.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  map: { flex: 1 },

  layerSelector: {
    position: 'absolute',
    top: 56,
    right: 16,
    flexDirection: 'row',
    backgroundColor: 'rgba(9, 14, 28, 0.88)',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: 3,
    gap: 2,
    zIndex: 10,
  },
  layerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  layerBtnActive: {
    backgroundColor: theme.flightIndigo,
  },
  layerBtnText: {
    color: theme.textFaint,
    fontSize: 11,
    fontWeight: '700',
  },
  layerBtnTextActive: {
    color: '#ffffff',
  },

  highlightAnchor: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
  },
  highlightBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: radius.card,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  highlightText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  highlightDismiss: { color: theme.accent, fontSize: 12 },

  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: radius.panel,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.live },
  pillText: { color: theme.textFaint, fontSize: 12, letterSpacing: 0.6 },
  pillProblem: { gap: 3 },
  pillProblemText: { color: theme.warn, fontSize: 12, letterSpacing: 0.6 },
  errorDetail: { color: theme.textFaint, fontSize: 10 },

  stats: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 12, gap: 28 },
  primary: { flexShrink: 1 },
  primaryValue: {
    color: theme.text,
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  secondary: { paddingBottom: 5 },
  secondaryValue: {
    color: theme.textMuted,
    fontSize: 19,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  label: { color: theme.textFaint, fontSize: 11, marginTop: 3, letterSpacing: 0.5 },

  earth: { color: theme.textFaint, fontSize: 11, marginTop: 11, lineHeight: 16 },
  credit: { color: theme.textFaint, fontSize: 9, marginTop: 6, opacity: 0.55 },
});
