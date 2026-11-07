/**
 * A flight as a ticket: the route on the left, and a stub torn along a dotted
 * line that answers the question of the moment. Flights still to fly are dark,
 * flights over are light. What it says is ticketFor's, which is tested.
 */

import { StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import type { TicketView } from '../flights/flightDisplay';
import { PressScale } from './PressScale';
import { useTheme } from './ThemeProvider';
import { FONT, radius } from './themes';
import { Text } from './Text';

const HEIGHT = 132;
const STUB = 104;
const NOTCH = 22;

export function Ticket({
  ticket,
  heading,
  onPress,
}: {
  ticket: TicketView;
  heading: string;
  onPress?: () => void;
}) {
  const t = useTheme();
  const background = ticket.past ? t.soft : t.tile;
  const primary = ticket.past ? t.ink : '#FFFFFF';
  const secondary = ticket.past ? t.muted : t.onTile;
  const notch = { backgroundColor: t.ground, right: STUB - NOTCH / 2 };

  return (
    <PressScale style={[styles.ticket, { backgroundColor: background }]} onPress={onPress}>
      <View style={styles.main}>
        <Text style={[styles.small, { color: secondary }]} numberOfLines={1}>
          {heading}
        </Text>
        <Text
          style={[styles.route, { color: primary }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {ticket.from} → {ticket.to}
        </Text>
        <Text style={[styles.small, { color: secondary }]} numberOfLines={1}>
          {ticket.when}
        </Text>
      </View>

      <View style={styles.stub}>
        {ticket.stubLabel ? (
          <Text style={[styles.stubLabel, { color: secondary }]}>{ticket.stubLabel}</Text>
        ) : null}
        <Text
          style={[styles.stubValue, { color: primary }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {ticket.stubValue}
        </Text>
      </View>

      {/* A dashed border on one side alone is not drawn dashed on Android. */}
      <Svg width={2} height={HEIGHT} style={styles.tear}>
        <Line x1={1} y1={0} x2={1} y2={HEIGHT} stroke={secondary} strokeWidth={2} strokeDasharray="5 6" />
      </Svg>
      <View style={[styles.notch, styles.notchTop, notch]} />
      <View style={[styles.notch, styles.notchBottom, notch]} />
    </PressScale>
  );
}

const styles = StyleSheet.create({
  ticket: {
    height: HEIGHT,
    borderRadius: radius.ticket,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  main: { flex: 1, paddingVertical: 16, paddingHorizontal: 20, justifyContent: 'space-between' },
  small: { fontSize: 14 },
  route: { fontFamily: FONT.extraBold, fontSize: 30, letterSpacing: -0.5 },
  stub: { width: STUB, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8 },
  stubLabel: { fontSize: 13 },
  stubValue: { fontFamily: FONT.extraBold, fontSize: 26 },
  tear: { position: 'absolute', top: 0, right: STUB - 1 },
  notch: { position: 'absolute', width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2 },
  notchTop: { top: -NOTCH / 2 },
  notchBottom: { bottom: -NOTCH / 2 },
});
