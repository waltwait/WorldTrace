/**
 * A trip's airports on one line: a solid line for a flight, a dashed one for the
 * ground between two airports, in at Tokyo and out at Osaka. What it shows is
 * routeChain's, which is tested. A long trip scrolls sideways rather than shrink.
 */

import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import type { RouteStep } from '../flights/trips';
import { Text } from './Text';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, type Theme } from './themes';

export function RouteLine({
  steps,
  large = false,
  fit = false,
}: {
  steps: readonly RouteStep[];
  large?: boolean;
  /** Squeeze into a fixed card width without scrolling sideways, for PNG export. */
  fit?: boolean;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const dot = large ? 14 : 10;
  // Lines run level with the middle of the dots.
  const lineTop = { marginTop: dot / 2 - 1 };

  const nodes = steps.map((step, index) => {
    if (step.kind === 'stop') {
      return (
        <View key={index} style={styles.stop}>
          <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2 }]} />
          <Text style={[styles.code, large && styles.codeLarge, fit && styles.codeFit]}>
            {step.iata}
          </Text>
        </View>
      );
    }

    const ground = step.kind === 'ground';
    return (
      <View
        key={index}
        style={[ground ? styles.ground : styles.flight, fit && styles.segmentFit, lineTop]}
      >
        {/* A dashed border on one side alone is not drawn dashed on Android. */}
        <Svg width="100%" height={2}>
          <Line
            x1={0}
            y1={1}
            x2="100%"
            y2={1}
            stroke={ground ? t.accent : t.tile}
            strokeWidth={2}
            strokeDasharray={ground ? '5 5' : undefined}
          />
        </Svg>
        <Text style={styles.label} numberOfLines={1}>
          {ground ? '地面' : step.flightNumber}
        </Text>
      </View>
    );
  });

  if (fit) {
    return <View style={styles.fitRow}>{nodes}</View>;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {nodes}
    </ScrollView>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    row: { flexGrow: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 4 },
    fitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingHorizontal: 4 },
    stop: { alignItems: 'center', gap: 4 },
    dot: { backgroundColor: t.tile },
    code: { color: t.ink, fontFamily: FONT.extraBold, fontSize: 13 },
    codeLarge: { fontSize: 15 },
    codeFit: { fontSize: 12 },
    flight: { flex: 1, minWidth: 52, alignItems: 'center', gap: 4 },
    ground: { flex: 0.6, minWidth: 36, alignItems: 'center', gap: 4 },
    segmentFit: { minWidth: 16 },
    label: { color: t.muted, fontSize: 11 },
  });
