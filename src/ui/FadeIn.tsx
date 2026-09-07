/**
 * Something arriving: a fade with a short travel behind it.
 *
 * Transform and opacity only, so the whole thing runs on the native driver and
 * survives a busy JS thread.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { CURVE, DURATION } from './motion';
import { useReducedMotion } from './useReducedMotion';

export function FadeIn({
  delay = 0,
  /** How far it travels, in points. Negative comes down from above. */
  offset = 8,
  style,
  children,
}: {
  delay?: number;
  offset?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION.enter,
      delay,
      easing: Easing.bezier(...CURVE.enter),
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduced]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [offset, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
