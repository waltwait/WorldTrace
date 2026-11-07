/**
 * A flight as a ticket: the route on the left, and a stub torn along a dotted
 * line that answers the question of the moment. Flights still to fly are dark,
 * flights over are light. What it says is ticketFor's, which is tested.
 */

import { StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import type { TicketView } from '../flights/flightDisplay';
import { PressScale } from './PressScale';
import { SwapText } from './SwapText';
import { useTheme } from './ThemeProvider';
import { FONT, radius } from './themes';
import { Text } from './Text';

const SIZES = {
  full: { height: 132, stub: 104, notch: 22 },
  // Inside a trip's block on the passport, which is the soft colour the ticket would be.
  small: { height: 76, stub: 76, notch: 16 },
} as const;

export function Ticket({
  ticket,
  heading,
  small = false,
  onPress,
  onLongPress,
}: {
  ticket: TicketView;
  /** Above the route; on a small ticket, the one line under it. */
  heading: string;
  small?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  const { height, stub, notch: notchSize } = SIZES[small ? 'small' : 'full'];
  const background = ticket.past ? (small ? t.ground : t.soft) : t.tile;
  const primary = ticket.past ? t.ink : '#FFFFFF';
  const secondary = ticket.past ? t.muted : t.onTile;
  const notch = {
    width: notchSize,
    height: notchSize,
    borderRadius: notchSize / 2,
    backgroundColor: small ? t.soft : t.ground,
    right: stub - notchSize / 2,
  };
  const route = (
    <Text
      style={[styles.route, small && styles.routeSmall, { color: primary }]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
    >
      {ticket.from} → {ticket.to}
    </Text>
  );

  return (
    <PressScale
      style={[styles.ticket, small && styles.ticketSmall, { height, backgroundColor: background }]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {small ? (
        <View style={[styles.main, styles.mainSmall]}>
          {route}
          <SwapText text={heading} style={[styles.smallest, { color: secondary }]} numberOfLines={1} />
        </View>
      ) : (
        <View style={styles.main}>
          <SwapText text={heading} style={[styles.small, { color: secondary }]} numberOfLines={1} />
          {route}
          <SwapText text={ticket.when} style={[styles.small, { color: secondary }]} numberOfLines={1} />
        </View>
      )}

      <View style={[styles.stub, { width: stub }]}>
        {ticket.stubLabel ? (
          <SwapText text={ticket.stubLabel} style={[styles.stubLabel, { color: secondary }]} />
        ) : null}
        <SwapText
          text={ticket.stubValue}
          style={[styles.stubValue, small && styles.stubValueSmall, { color: primary }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        />
      </View>

      {/* A dashed border on one side alone is not drawn dashed on Android. */}
      <Svg width={2} height={height} style={[styles.tear, { right: stub - 1 }]}>
        <Line x1={1} y1={0} x2={1} y2={height} stroke={secondary} strokeWidth={2} strokeDasharray="5 6" />
      </Svg>
      <View style={[styles.notch, { top: -notchSize / 2 }, notch]} />
      <View style={[styles.notch, { bottom: -notchSize / 2 }, notch]} />
    </PressScale>
  );
}

const styles = StyleSheet.create({
  ticket: {
    borderRadius: radius.ticket,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  ticketSmall: { borderRadius: 18 },
  main: { flex: 1, paddingVertical: 16, paddingHorizontal: 20, justifyContent: 'space-between' },
  mainSmall: { paddingVertical: 10, paddingHorizontal: 16, justifyContent: 'center', gap: 2 },
  small: { fontSize: 14 },
  smallest: { fontSize: 12 },
  route: { fontFamily: FONT.extraBold, fontSize: 30, letterSpacing: -0.5 },
  routeSmall: { fontSize: 21, letterSpacing: -0.3 },
  stub: { alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8 },
  stubLabel: { fontSize: 13 },
  stubValue: { fontFamily: FONT.extraBold, fontSize: 26 },
  stubValueSmall: { fontSize: 18 },
  tear: { position: 'absolute', top: 0 },
  notch: { position: 'absolute' },
});
