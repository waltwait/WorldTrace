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
  /** How far it travels, in points. Negative comes from above or from the left. */
  offset = 8,
  axis = 'y',
  /** Pair the entrance with a slight spring scale, as cards and popovers do. */
  pop = false,
  style,
  children,
}: {
  delay?: number;
  offset?: number;
  axis?: 'y' | 'x';
  pop?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(pop ? 0.96 : 1)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      scale.setValue(1);
      return;
    }

    const enter = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION.enter,
      delay,
      easing: Easing.bezier(...CURVE.enter),
      useNativeDriver: true,
    });

    if (!pop) {
      scale.setValue(1);
      enter.start();
      return () => enter.stop();
    }

    const spring = Animated.spring(scale, {
      toValue: 1,
      tension: 180,
      friction: 16,
      useNativeDriver: true,
    });
    const animation = Animated.parallel([
      enter,
      delay > 0 ? Animated.sequence([Animated.delay(delay), spring]) : spring,
    ]);

    animation.start();
    return () => animation.stop();
  }, [delay, pop, progress, reduced, scale]);

  const shift = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [offset, 0],
  });
  const move = axis === 'x' ? { translateX: shift } : { translateY: shift };

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: pop ? [move, { scale }] : [move],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
