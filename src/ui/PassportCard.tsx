/** The flying so far, in one line under the flags of where it went, and the way into the passport. */

import { StyleSheet, View } from 'react-native';
import { flagEmoji } from '../flights/countries';
import { computePassportStats, countryStamps } from '../flights/flightStats';
import type { FlightRecord } from '../flights/types';
import { formatWholeKm } from './format';
import { useHomeCountry } from './HomeCountry';
import { flagRow } from './flagRow';
import { Icon } from './Icon';
import { PressScale } from './PressScale';
import { SwapText } from './SwapText';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, radius, type Theme } from './themes';
import { Text } from './Text';

export function PassportCard({
  flights,
  onOpen,
}: {
  flights: FlightRecord[];
  onOpen: () => void;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const { home } = useHomeCountry();
  const passport = computePassportStats(flights, home);
  // In the stamps' order, as on the passport. Seven fit beside the name on a narrow phone.
  const flags = flagRow(
    countryStamps(flights, home).map((stamp) => stamp.code),
    7,
  );

  return (
    <PressScale style={styles.card} onPress={onOpen}>
      <View style={styles.head}>
        <Text style={styles.name}>飛行護照</Text>
        <View style={styles.flags}>
          {flags.codes.map((code) => (
            <Text key={code} style={styles.flag}>
              {flagEmoji(code)}
            </Text>
          ))}
          {flags.more > 0 ? <Text style={styles.more}>+{flags.more}</Text> : null}
        </View>
        <Icon name="chevronRight" color={t.muted} size={18} />
      </View>
      <View style={styles.facts}>
        <Fact label="航班" value={`${passport.totalFlights}`} />
        <Fact label="小時" value={`${passport.totalHours}`} />
        <Fact label="距離" value={formatWholeKm(passport.totalKm)} wide />
      </View>
    </PressScale>
  );
}

/**
 * The distance is the long one, so it gets twice the room. It can still shrink to
 * fit, and a line of its own height keeps a shrunken value from pulling its label
 * up out of line with the others.
 */
function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  const styles = useStyles(make);
  return (
    <View style={wide ? styles.factWide : styles.fact}>
      <View style={styles.valueLine}>
        <SwapText
          text={value}
          style={styles.value}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        />
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    card: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radius.group,
      backgroundColor: t.soft,
      gap: 4,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    flags: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
    flag: { fontSize: 16 },
    more: { color: t.muted, fontFamily: FONT.bold, fontSize: 12 },
    name: { color: t.ink, fontSize: 14, fontWeight: '700' },
    facts: { flexDirection: 'row', gap: 10 },
    fact: { flex: 1, minWidth: 0 },
    factWide: { flex: 2, minWidth: 0 },
    valueLine: { height: 26, justifyContent: 'flex-end' },
    value: { color: t.ink, fontFamily: FONT.bold, fontSize: 19 },
    label: { color: t.muted, fontSize: 12 },
  });
