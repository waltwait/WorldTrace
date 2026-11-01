/**
 * Something that answers a press.
 *
 * Down is instant — a control that waits to be believed feels broken — and up
 * eases back, so release reads as the control springing back rather than
 * snapping. The shrink is small on purpose (see PRESS_SCALE).
 *
 * Only transform and opacity move, both on the native driver. This matters here
 * more than most places: "Redraw the fog" occupies the JS thread for seconds,
 * and anything driven from JS would freeze mid-press while it ran.
 *
 * With reduced motion on there is no shrink, only the dimming, so a press is
 * still acknowledged.
 */

import { useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { CURVE, DURATION, PRESS_SCALE } from './motion';
import { useReducedMotion } from './useReducedMotion';

const PRESSED_OPACITY = 0.85;

export function PressScale({
  children,
  style,
  containerStyle,
  disabled,
  onPress,
  hitSlop,
}: {
  children: ReactNode;
  /** What the control looks like. This is the part that shrinks. */
  style?: StyleProp<ViewStyle>;
  /** Where it sits in its parent: flex and margins, which must not shrink with it. */
  containerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  onPress?: PressableProps['onPress'];
  hitSlop?: PressableProps['hitSlop'];
}) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const dim = useRef(new Animated.Value(1)).current;

  const down = () => {
    scale.stopAnimation();
    dim.stopAnimation();
    if (!reduced) scale.setValue(PRESS_SCALE);
    dim.setValue(PRESSED_OPACITY);
  };

  const up = () => {
    if (reduced) {
      dim.setValue(1);
      return;
    }

    const settle = { duration: DURATION.press, easing: Easing.bezier(...CURVE.enter), useNativeDriver: true };
    Animated.parallel([
      Animated.timing(scale, { toValue: 1, ...settle }),
      Animated.timing(dim, { toValue: 1, ...settle }),
    ]).start();
  };

  return (
    <Pressable
      style={containerStyle}
      onPress={onPress}
      onPressIn={down}
      onPressOut={up}
      disabled={disabled}
      hitSlop={hitSlop}
    >
      <Animated.View style={[style, { opacity: dim, transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
