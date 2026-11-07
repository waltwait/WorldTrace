/**
 * Text that changes in place.
 *
 * The old text leaves upward and fades, the new arrives from below and fades in:
 * two short moves one after the other, so the eye follows the change instead of
 * seeing a flash. Opacity and a few points of travel only — no blur, which the
 * native driver cannot animate — and it stays on the native driver, which keeps
 * it moving while the JS thread is busy with the work this text is reporting on.
 *
 * The first text is shown as it is: nothing has changed yet, so nothing moves.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { CURVE, DURATION, SWAP_OFFSET } from './motion';
import { useReducedMotion } from './useReducedMotion';
import { textStyle } from './Text';

export function SwapText({
  text,
  style,
  numberOfLines,
  ellipsizeMode,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  ellipsizeMode?: TextProps['ellipsizeMode'];
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(text);
  const shownRef = useRef(text);
  const opacity = useRef(new Animated.Value(1)).current;
  const offset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (text === shownRef.current) {
      // Changed and changed back mid-swap: put the text back where it was.
      opacity.setValue(1);
      offset.setValue(0);
      return;
    }

    if (reduced) {
      shownRef.current = text;
      setShown(text);
      return;
    }

    const ease = Easing.bezier(...CURVE.enter);
    let cancelled = false;

    const leaving = Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: DURATION.swapOut, easing: ease, useNativeDriver: true }),
      Animated.timing(offset, { toValue: -SWAP_OFFSET, duration: DURATION.swapOut, easing: ease, useNativeDriver: true }),
    ]);

    leaving.start(({ finished }) => {
      if (!finished || cancelled) return;

      shownRef.current = text;
      setShown(text);
      offset.setValue(SWAP_OFFSET);

      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: DURATION.swapIn, easing: ease, useNativeDriver: true }),
        Animated.timing(offset, { toValue: 0, duration: DURATION.swapIn, easing: ease, useNativeDriver: true }),
      ]).start();
    });

    return () => {
      cancelled = true;
      leaving.stop();
    };
  }, [text, reduced, opacity, offset]);

  return (
    <Animated.Text
      style={[textStyle(style), { opacity, transform: [{ translateY: offset }] }]}
      numberOfLines={numberOfLines}
      ellipsizeMode={ellipsizeMode}
    >
      {shown}
    </Animated.Text>
  );
}
