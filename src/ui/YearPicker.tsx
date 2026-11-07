/**
 * The years the passport can be narrowed to, rising from the bottom of the page, with
 * how many flights each holds: the button in the header says which one is showing.
 * Choosing one closes it; so do the back button and a tap outside.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Pressable, StyleSheet, View } from 'react-native';
import type { YearChoice } from '../flights/trips';
import { Icon } from './Icon';
import { CURVE, DURATION } from './motion';
import { PressScale } from './PressScale';
import { Text } from './Text';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, type Theme } from './themes';
import { useReducedMotion } from './useReducedMotion';

/** The button in the header that opens it. */
export function YearButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles(make);
  const t = useTheme();
  return (
    <PressScale style={styles.button} onPress={onPress} label={`年份 ${label}`} hitSlop={4}>
      <Text style={styles.buttonText}>{label}</Text>
      <Icon name="chevronDown" color={t.ink} size={16} />
    </PressScale>
  );
}

export function YearPicker({
  choices,
  chosen,
  visible,
  onChoose,
  onClose,
}: {
  choices: readonly YearChoice[];
  chosen: string | null;
  visible: boolean;
  onChoose: (year: string | null) => void;
  onClose: () => void;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
    if (!visible && !mounted) return;
    if (reduced) {
      progress.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? DURATION.enter : DURATION.exit,
      easing: visible ? Easing.bezier(...CURVE.enter) : Easing.bezier(...CURVE.move),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [mounted, progress, reduced, visible]);

  // Before the page's own: back closes this, not the passport underneath.
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose, visible]);

  if (!mounted) return null;

  const rise = progress.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="關閉" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { opacity: progress, transform: [{ translateY: rise }] }]}>
        <View style={styles.grabber} />
        {choices.map((choice, index) => {
          const on = choice.year === chosen;
          return (
            <PressScale
              key={choice.label}
              style={[styles.row, index > 0 && styles.line]}
              onPress={() => onChoose(choice.year)}
            >
              <Text style={[styles.year, on && styles.yearOn]}>{choice.label}</Text>
              <Text style={styles.count}>{choice.flights} 班</Text>
              <View style={[styles.check, !on && styles.hidden]}>
                <Icon name="check" color={t.ink} size={18} />
              </View>
            </PressScale>
          );
        })}
      </Animated.View>
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    button: {
      height: 44,
      paddingLeft: 16,
      paddingRight: 12,
      borderRadius: 22,
      backgroundColor: t.soft,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    buttonText: { color: t.ink, fontFamily: FONT.bold, fontSize: 15 },

    scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20, 28, 36, 0.5)' },
    sheet: {
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 12,
      paddingTop: 8,
      paddingBottom: 10,
      borderRadius: 28,
      backgroundColor: t.soft,
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.accent,
      marginTop: 4,
      marginBottom: 6,
    },
    row: { height: 52, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
    line: { borderTopWidth: 1, borderTopColor: t.ground },
    year: { color: t.ink, fontFamily: FONT.bold, fontSize: 17 },
    yearOn: { fontFamily: FONT.extraBold },
    count: { marginLeft: 12, color: t.muted, fontSize: 13 },
    check: { marginLeft: 'auto' },
    hidden: { opacity: 0 },
  });
