/**
 * Spherical flight-arc panel for shareable cards.
 *
 * Draws airport-to-airport Great Circle arcs over the world's coastlines and a subtle
 * graticule — never street maps or fog tiles — so shared cards never reveal where the
 * user lives. Without the land nobody could tell where an arc went.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { projectFlightArcs, ringsPath } from '../flights/arcDiagram';
import type { FlightRecord } from '../flights/types';
import { Text } from './Text';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, type Theme } from './themes';

export function ArcDiagram({
  flights,
  width,
  height,
  connectGround = false,
  showLabels = false,
  inset = false,
}: {
  flights: readonly FlightRecord[];
  width: number;
  height: number;
  connectGround?: boolean;
  showLabels?: boolean;
  /** True when placed inside a dark passport cover (`t.fog` against `t.tile`). */
  inset?: boolean;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const layout = useMemo(
    () => projectFlightArcs(flights, { width, height }, { connectGround, showLabels }),
    [connectGround, flights, height, showLabels, width],
  );

  const land = useMemo(() => (layout ? ringsPath(layout.land) : ''), [layout]);

  if (!layout) return null;

  const surface = inset ? t.fog : t.tile;

  return (
    <View
      style={[
        styles.panel,
        inset ? styles.panelInset : styles.panelStandalone,
        { width, height, backgroundColor: surface },
      ]}
    >
      <Svg width={width} height={height}>
        {layout.gridLines.map((line, index) => (
          <Line
            key={`g-${index}`}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={t.onTile}
            strokeOpacity={0.14}
            strokeWidth={0.8}
          />
        ))}

        {land ? <Path d={land} fill={t.onTile} fillOpacity={0.14} fillRule="evenodd" /> : null}

        {layout.groundLinks.map((line, index) => (
          <Line
            key={`gr-${index}`}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={t.accent}
            strokeWidth={2}
            strokeDasharray="4 4"
            strokeLinecap="round"
          />
        ))}

        {layout.arcs.map((d, index) => (
          <Path
            key={`glow-${index}`}
            d={d}
            stroke="#FFFFFF"
            strokeOpacity={0.18}
            strokeWidth={5}
            strokeLinecap="round"
            fill="none"
          />
        ))}

        {layout.arcs.map((d, index) => (
          <Path
            key={`arc-${index}`}
            d={d}
            stroke="#FFFFFF"
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
          />
        ))}

        {layout.airports.map((ap) => (
          <Circle key={`halo-${ap.iata}`} cx={ap.x} cy={ap.y} r={5.2} fill={surface} />
        ))}
        {layout.airports.map((ap) => (
          <Circle key={`dot-${ap.iata}`} cx={ap.x} cy={ap.y} r={3.5} fill="#FFFFFF" />
        ))}
      </Svg>

      {layout.labels.map((label) => (
        <View
          key={`lbl-${label.iata}`}
          style={[
            styles.badge,
            {
              left: label.x,
              top: label.y,
              width: label.width,
              height: label.height,
              backgroundColor: surface,
            },
          ]}
        >
          <Text style={styles.iata} numberOfLines={1}>
            {label.iata}
          </Text>
        </View>
      ))}
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    panel: { overflow: 'hidden' },
    panelStandalone: { borderRadius: 22 },
    panelInset: { borderRadius: 18 },
    badge: {
      position: 'absolute',
      borderRadius: 8,
      opacity: 0.9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iata: {
      color: t.onTile,
      fontFamily: FONT.extraBold,
      fontSize: 10.5,
    },
  });
