/**
 * The names of a pager's pages, the one showing large and strong, following the
 * swipe as it goes rather than jumping when it lands (tabMotion). A font size cannot
 * be animated on the native driver, so each name is drawn at full size and scaled
 * down, the strong and the quiet text over each other and faded between. Scaling
 * pivots on the middle, so a name is moved to keep its bottom left corner where it
 * was, and the names after a small one move left by the room it gave up.
 */

import { useMemo, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { tabMotion } from './pager';
import { PressScale } from './PressScale';
import { textStyle } from './Text';
import { useStyles } from './ThemeProvider';
import type { Theme } from './themes';

const FULL = 22;
const SMALL = 17 / FULL;

export function SectionTabs({
  names,
  scrollX,
  width,
  onSelect,
}: {
  names: readonly string[];
  /** The pager's horizontal offset. */
  scrollX: Animated.Value;
  /** One page's width. */
  width: number;
  onSelect: (index: number) => void;
}) {
  const styles = useStyles(make);
  // Every name is two characters, so one name's size is all of theirs.
  const [box, setBox] = useState({ width: 0, height: 0 });

  const motions = useMemo(() => {
    if (width <= 0) return null;
    const along = (index: number, outputRange: number[]): Animated.AnimatedInterpolation<number> =>
      scrollX.interpolate({ inputRange: tabMotion(index, width, SMALL).inputRange, outputRange, extrapolate: 'clamp' });

    return names.map((_, index) => {
      const own = tabMotion(index, width, SMALL);
      // Half its own lost width keeps its left edge still; the others' whole.
      const before = names
        .slice(0, index)
        .map((__, j) => along(j, tabMotion(j, width, SMALL).shrink.map((s) => -s * box.width)));
      const shiftX = before.reduce<Animated.AnimatedInterpolation<number>>(
        (sum, part) => Animated.add(sum, part),
        along(index, own.shrink.map((s) => (-s * box.width) / 2)),
      );
      return {
        scale: along(index, own.scale),
        strong: along(index, own.strong),
        quiet: along(index, own.quiet),
        shiftX,
        shiftY: along(index, own.shrink.map((s) => (s * box.height) / 2)),
      };
    });
  }, [box.height, box.width, names, scrollX, width]);

  return (
    <View style={styles.row}>
      {names.map((name, index) => {
        const motion = motions?.[index];
        return (
          <PressScale key={name} onPress={() => onSelect(index)} hitSlop={8}>
            <Animated.View
              onLayout={
                index === 0
                  ? (event) => {
                      const { width: w, height: h } = event.nativeEvent.layout;
                      setBox((old) => (old.width === w && old.height === h ? old : { width: w, height: h }));
                    }
                  : undefined
              }
              style={
                motion
                  ? {
                      transform: [
                        { translateX: motion.shiftX },
                        { translateY: motion.shiftY },
                        { scale: motion.scale },
                      ],
                    }
                  : undefined
              }
            >
              <Animated.Text style={[textStyle(styles.strong), motion && { opacity: motion.strong }]}>
                {name}
              </Animated.Text>
              <Animated.Text
                style={[
                  textStyle(styles.quiet),
                  StyleSheet.absoluteFill,
                  { opacity: motion ? motion.quiet : 0 },
                ]}
              >
                {name}
              </Animated.Text>
            </Animated.View>
          </PressScale>
        );
      })}
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: 18, paddingHorizontal: 8, marginTop: 4 },
    strong: { color: t.ink, fontSize: FULL, fontWeight: '900' },
    quiet: { color: t.muted, fontSize: FULL, fontWeight: '500' },
  });
