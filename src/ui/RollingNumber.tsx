/**
 * A number that counts to its value.
 *
 * Shared by the stats screen, where the numbers arrive with the screen, and the
 * map's panel, where they creep up as ground is cleared. Only a change that
 * shows in the formatted text is animated.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, type StyleProp, type TextStyle } from 'react-native';
import { countUpValue, CURVE, DURATION, shouldCount, shouldFlip, SWAP_OFFSET } from './motion';
import { useReducedMotion } from './useReducedMotion';
import { textStyle } from './Text';

/**
 * A number that counts to its value, with a vertical flip impulse on live ticks.
 *
 * Text content cannot be driven natively, so count-up runs on the JS thread —
 * which is why it is its own component. On the map card (`!arriving`), a single
 * step (e.g. 1.23 km -> 1.24 km) has no intermediate formatted strings, so a
 * native-driver vertical flip (`translateY` + `opacity`) gives every visible
 * digit change a physical odometer roll.
 */
export function RollingNumber({
  value,
  format,
  run,
  style,
  fit = false,
}: {
  value: number;
  format: (value: number) => string;
  run: number;
  style: StyleProp<TextStyle>;
  fit?: boolean;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const runRef = useRef(run);
  const progress = useRef(new Animated.Value(0)).current;
  const flipY = useRef(new Animated.Value(0)).current;
  const flipOpacity = useRef(new Animated.Value(1)).current;
  // Read through a ref, not listed as a dependency: callers pass inline
  // formatters, and a new function on every render of the screen re-ran the
  // effect, which stopped a count-up halfway and jumped it to the end.
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const arriving = runRef.current !== run;
    runRef.current = run;

    // Arriving on the screen counts up from nothing; a value that moved while
    // the screen was already open carries on from where the digits stood.
    const from = arriving ? 0 : shownRef.current;

    const settle = () => {
      shownRef.current = value;
      setShown(value);
    };

    // Nothing to see, or nothing that was earned by arriving: no animation, and
    // no JS thread time spent making one.
    const format = formatRef.current;
    if (reduced || !shouldCount({ from, to: value, arriving, format })) {
      flipY.setValue(0);
      flipOpacity.setValue(1);
      settle();
      return;
    }

    // Live tick while the screen is already open (e.g. on the map card):
    // flip the old reading out upward and bring the new reading in from below,
    // entirely on the native driver with a single state update at the midpoint.
    if (shouldFlip({ from, to: value, arriving, format })) {
      const ease = Easing.bezier(...CURVE.enter);
      let cancelled = false;

      const leaving = Animated.parallel([
        Animated.timing(flipOpacity, {
          toValue: 0,
          duration: DURATION.swapOut,
          easing: ease,
          useNativeDriver: true,
        }),
        Animated.timing(flipY, {
          toValue: -SWAP_OFFSET,
          duration: DURATION.swapOut,
          easing: ease,
          useNativeDriver: true,
        }),
      ]);

      leaving.start(({ finished }) => {
        if (!finished || cancelled) return;

        settle();
        flipY.setValue(SWAP_OFFSET);

        Animated.parallel([
          Animated.timing(flipOpacity, {
            toValue: 1,
            duration: DURATION.swapIn,
            easing: ease,
            useNativeDriver: true,
          }),
          Animated.timing(flipY, {
            toValue: 0,
            duration: DURATION.swapIn,
            easing: ease,
            useNativeDriver: true,
          }),
        ]).start();
      });

      return () => {
        cancelled = true;
        leaving.stop();
      };
    }

    flipY.setValue(0);
    flipOpacity.setValue(1);
    progress.setValue(0);
    const listener = progress.addListener(({ value: t }) => {
      const next = countUpValue(from, value, t);
      shownRef.current = next;
      setShown(next);
    });

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION.count,
      delay: arriving ? DURATION.page : 0,
      easing: Easing.bezier(...CURVE.enter),
      useNativeDriver: false,
    });

    animation.start(({ finished }) => {
      if (finished) settle();
    });

    return () => {
      animation.stop();
      progress.removeListener(listener);
    };
  }, [value, run, reduced, progress, flipY, flipOpacity]);

  return (
    <Animated.Text
      style={[textStyle(style), { opacity: flipOpacity, transform: [{ translateY: flipY }] }]}
      numberOfLines={1}
      adjustsFontSizeToFit={fit}
      minimumFontScale={fit ? 0.6 : undefined}
    >
      {format(shown)}
    </Animated.Text>
  );
}
