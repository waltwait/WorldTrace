import { Camera, GeoJSONSource, Layer, Map, UserLocation } from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TrackSegment } from '../export/gpx';
import { fogFeature } from '../fog/geojson';
import { compareToLandmark, formatEarthShare } from './earth';
import { formatArea, formatDistance } from './format';
import { radius, theme } from './theme';
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
}

export function MapScreen({ recorder, highlighted, onClearHighlight }: MapScreenProps) {
  // Rebuilding the fog geometry is the expensive part of a frame, so it is
  // tied to the tiles themselves rather than to every counter update.
  const fog = useMemo(() => fogFeature(recorder.tiles), [recorder.tiles]);

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

  return (
    <View style={styles.container}>
      {/* androidView="texture": v11 switched Android to GLSurfaceView by
          default, which renders the map horizontally mirrored on this device.
          TextureView is the documented fallback. */}
      <Map
        style={styles.map}
        mapStyle={OSM_STYLE}
        logo={false}
        attribution={false}
        androidView="texture"
      >
        {/* "default" follows your position but never touches the bearing, so
            north stays up. "course" and "heading" both spin the map under you,
            which makes a fog map much harder to read — you lose track of which
            way the cleared ground runs. Rotating by hand still works. */}
        <Camera
          initialViewState={{ center: INITIAL_CENTER, zoom: 15, bearing: 0 }}
          trackUserLocation={highlighted ? undefined : 'default'}
        />
        <UserLocation />

        <GeoJSONSource id="fog" data={fog}>
          <Layer
            id="fog-fill"
            type="fill"
            paint={{ 'fill-color': theme.fog, 'fill-opacity': theme.fogOpacity }}
          />
        </GeoJSONSource>

        {trackLines ? (
          <GeoJSONSource id="day-track" data={trackLines}>
            <Layer
              id="day-track-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': theme.trackLine, 'line-width': 4, 'line-opacity': 0.9 }}
            />
          </GeoJSONSource>
        ) : null}
      </Map>

      {highlighted ? (
        <Pressable style={styles.highlightBanner} onPress={onClearHighlight}>
          <Text style={styles.highlightText}>{highlighted.label} 的軌跡</Text>
          <Text style={styles.highlightDismiss}>返回即時 ✕</Text>
        </Pressable>
      ) : null}

      <View style={styles.panel}>
        <StatusPill state={recorder} />

        <View style={styles.stats}>
          <View style={styles.primary}>
            <Text style={styles.primaryValue}>
              {formatArea(recorder.exploredSquareMeters)}
            </Text>
            <Text style={styles.label}>已探索</Text>
          </View>
          <View style={styles.secondary}>
            <Text style={styles.secondaryValue}>{formatDistance(recorder.distanceMeters)}</Text>
            <Text style={styles.label}>走過</Text>
          </View>
        </View>

        <Text style={styles.earth}>
          佔地球表面 {formatEarthShare(recorder.exploredSquareMeters)}
          {landmark ? `　·　${landmark}` : ''}
        </Text>

        {/* The native attribution button was turned off because its dialog
            covered the map. OpenStreetMap's tile policy still requires a
            visible credit, so it moves here. */}
        <Text style={styles.credit}>© OpenStreetMap contributors</Text>
      </View>
    </View>
  );
}

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

  highlightBanner: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
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
