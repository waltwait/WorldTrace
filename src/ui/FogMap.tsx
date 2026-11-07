/**
 * The one map in the app. It is a tile on the overview and fills the screen when
 * opened, and it stays the same map through both: a second one for the tile would
 * mean a second native view and a second fog to build. See OverviewScreen.
 */

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
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import type { TrackSegment } from '../export/gpx';
import {
  buildFlightArcsGeoJson,
  buildGreatCircleArc,
  flightEnds,
  routesKey,
} from '../flights/greatCircle';
import { routeCamera } from '../flights/routeCamera';
import type { FlightRecord } from '../flights/types';
import { FadeIn } from './FadeIn';
import { formatArea } from './format';
import { Icon } from './Icon';
import { DURATION } from './motion';
import { PressScale } from './PressScale';
import { RollingNumber } from './RollingNumber';
import { useStyles, useTheme } from './ThemeProvider';
import { radius, SHARED, type Theme } from './themes';
import { useFog } from './useFog';
import type { RecorderState } from './useRecorder';
import { Text } from './Text';

// In grey, so that the theme's fog and the ground it opens onto read as one
// picture. The brightness floor keeps what was walked light against the fog.
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
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-saturation': -1, 'raster-brightness-min': 0.6 },
    },
  ],
};

const FOG_OPACITY = 0.93;

const INITIAL_CENTER: [number, number] = [121.5654, 25.033];

const LAYERS = [
  { mode: 'all', label: '全部' },
  { mode: 'fog', label: '迷霧' },
  { mode: 'flights', label: '航線' },
] as const;

type LayerMode = (typeof LAYERS)[number]['mode'];

export interface FogMapProps {
  recorder: RecorderState;
  flights: FlightRecord[];
  /** A past day being reviewed, drawn over the fog. */
  highlighted: { label: string; segments: TrackSegment[] } | null;
  focusedFlight: FlightRecord | null;
  expanded: boolean;
  /**
   * Whether anyone can see the map. Following the user makes it draw every frame
   * even sitting still, and a map behind another page has no reason to.
   */
  active: boolean;
  onCollapse: () => void;
}

/** Frames a second for the map. The screen does 120, and the map needs nothing like it. */
const MAP_FPS = 60;

export const FogMap = memo(function FogMap({
  recorder,
  flights,
  highlighted,
  focusedFlight,
  expanded,
  active,
  onCollapse,
}: FogMapProps) {
  const t = useTheme();
  const styles = useStyles(make);
  const [layerMode, setLayerMode] = useState<LayerMode>('all');
  // The map mounts with the app and "view on map" can come before it has loaded:
  // a camera moved before that goes nowhere.
  const [mapReady, setMapReady] = useState(false);
  const cameraRef = useRef<CameraRef>(null);
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    if (!focusedFlight || !mapReady) return;
    if (layerMode === 'fog') {
      setLayerMode('all');
    }
    const ends = flightEnds(focusedFlight);
    if (ends) {
      // Framed from the arc itself, the short way round: a box from the two
      // airports' smallest to largest longitude framed TPE→LAX on Africa.
      const route = buildGreatCircleArc(ends.dep, ends.arr, 40);
      const padding = { top: 120, bottom: 140, left: 60, right: 60 };
      const { center, zoom } = routeCamera(route, { width, height }, padding);
      cameraRef.current?.easeTo({ center, zoom, padding, duration: 1200 });
    }
  }, [focusedFlight, mapReady]);

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

  const banner = focusedFlight
    ? `${focusedFlight.flightNumber}  ${focusedFlight.depIata} → ${focusedFlight.arrIata}`
    : highlighted
      ? `${highlighted.label} 的軌跡`
      : null;

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
        preferredFramesPerSecond={MAP_FPS}
        onRegionIsChanging={(event) => onMapMoving(event.nativeEvent)}
        onRegionDidChange={(event) => onMapView(event.nativeEvent)}
        onDidFinishLoadingMap={() => {
          setMapReady(true);
          void reportView();
        }}
      >
        {/* "default" follows your position but never touches the bearing, so
            north stays up. "course" and "heading" both spin the map under you,
            which makes a fog map much harder to read — you lose track of which
            way the cleared ground runs. Rotating by hand still works. */}
        <Camera
          ref={cameraRef}
          initialViewState={{ center: INITIAL_CENTER, zoom: 15, bearing: 0 }}
          trackUserLocation={highlighted || focusedFlight || !active ? undefined : 'default'}
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
        {layerMode !== 'flights' ? (
          <GeoJSONSource id="fog" data={fog} maxzoom={18} tolerance={0}>
            <Layer
              id="fog-fill"
              type="fill"
              paint={{
                'fill-color': t.fog,
                'fill-opacity': FOG_OPACITY,
                'fill-antialias': false,
              }}
            />
          </GeoJSONSource>
        ) : null}

        {flightArcs && layerMode !== 'fog' ? (
          <GeoJSONSource id="flight-arcs" data={flightArcs} maxzoom={18}>
            {/* Dark, on a pale edge. The map is pale and the fog is dark, and a route
                crosses both: white alone read as a gap in the map, and dark alone
                would vanish into the fog. */}
            <Layer
              id="flight-arcs-outer"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': t.ground, 'line-width': 5.5, 'line-opacity': 0.9 }}
            />
            <Layer
              id="flight-arcs-inner"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': t.ink, 'line-width': 2.5 }}
            />
          </GeoJSONSource>
        ) : null}

        {trackLines ? (
          <GeoJSONSource id="day-track" data={trackLines} maxzoom={18}>
            <Layer
              id="day-track-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': t.tile, 'line-width': 4, 'line-opacity': 0.9 }}
            />
          </GeoJSONSource>
        ) : null}
      </Map>

      {expanded ? (
        <>
          <MapCredit expanded />

          <View style={styles.top}>
            <PressScale style={styles.back} onPress={onCollapse} label="返回" hitSlop={8}>
              <Icon name="back" color="#FFFFFF" />
            </PressScale>
            <View style={styles.layers}>
              {LAYERS.map(({ mode, label }) => (
                <PressScale
                  key={mode}
                  style={[styles.layer, layerMode === mode && styles.layerOn]}
                  onPress={() => setLayerMode(mode)}
                >
                  <Text style={[styles.layerText, layerMode === mode && styles.layerTextOn]}>
                    {label}
                  </Text>
                </PressScale>
              ))}
            </View>
          </View>

          {banner ? (
            // Delayed past the map opening: one thing moves at a time.
            <FadeIn key={banner} style={styles.bannerAnchor} offset={-8} delay={DURATION.page}>
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{banner}</Text>
              </View>
            </FadeIn>
          ) : null}

          <View style={styles.bottom}>
            <RollingNumber
              value={recorder.exploredSquareMeters}
              format={formatArea}
              run={0}
              style={styles.area}
              fit
            />
            <RecordingStatus recorder={recorder} />
          </View>
        </>
      ) : null}
    </View>
  );
});

/** OpenStreetMap's tile policy requires a visible credit, on the tile as well. */
export function MapCredit({ expanded }: { expanded: boolean }) {
  const styles = useStyles(make);
  return (
    <Text style={[styles.credit, expanded && styles.creditExpanded]}>
      © OpenStreetMap contributors
    </Text>
  );
}

export function RecordingStatus({ recorder }: { recorder: RecorderState }) {
  const styles = useStyles(make);

  if (recorder.status === 'recording') {
    return (
      <View style={styles.status}>
        <View style={styles.liveDot} />
        <Text style={styles.statusText}>記錄中</Text>
      </View>
    );
  }

  const message =
    recorder.status === 'starting'
      ? '啟動中…'
      : recorder.status === 'denied'
        ? '需要「一律允許」定位權限'
        : '無法開始記錄';

  return (
    <View style={styles.problem}>
      <Text style={styles.statusText}>{message}</Text>
      {recorder.error && recorder.status === 'failed' ? (
        <Text style={styles.problemDetail} numberOfLines={2}>
          {recorder.error}
        </Text>
      ) : null}
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.tile },
    map: { flex: 1 },

    credit: {
      position: 'absolute',
      right: 14,
      top: 12,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: 'rgba(255, 255, 255, 0.7)',
      color: t.ink,
      fontSize: 10,
    },
    creditExpanded: { top: undefined, bottom: 104 },

    top: {
      position: 'absolute',
      left: 16,
      right: 16,
      top: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    back: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    layers: { flexDirection: 'row', padding: 4, borderRadius: radius.round, backgroundColor: t.ink },
    layer: { height: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center' },
    layerOn: { backgroundColor: t.accent },
    layerText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    layerTextOn: { color: t.ink },

    bannerAnchor: { position: 'absolute', top: 104, left: 16, right: 16, alignItems: 'center' },
    banner: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radius.round,
      backgroundColor: t.ink,
    },
    bannerText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

    bottom: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: radius.ticket,
      backgroundColor: t.ink,
    },
    area: { flex: 1, color: '#FFFFFF', fontSize: 26, fontWeight: '800' },

    status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: SHARED.live },
    statusText: { color: '#FFFFFF', fontSize: 14 },
    problem: {
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 14,
      backgroundColor: SHARED.danger,
    },
    problemDetail: { color: '#FFFFFF', fontSize: 12, marginTop: 2 },
  });
