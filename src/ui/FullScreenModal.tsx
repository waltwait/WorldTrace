/**
 * In-window full-screen sheet with iOS-like spring motion.
 *
 * Replaces React Native's <Modal animationType="slide">, which spawns a separate
 * Android Dialog window without a scrim and races layout against the window
 * animation. Rendering inside the root View keeps status/navigation bars steady,
 * dims the page underneath in lockstep with progress, paints one off-screen frame
 * so children finish layout before moving, and drives open (0.42 s) and close
 * (0.30 s) with critically-damped native-driver springs that reverse cleanly
 * mid-flight.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SCREEN_SPRING, slideOffsetPx } from './motion';
import { useStyles } from './ThemeProvider';
import type { Theme } from './themes';
import { useReducedMotion } from './useReducedMotion';

export interface FullScreenModalProps {
  visible: boolean;
  onRequestClose: () => void;
  onEntered?: () => void;
  onExited?: () => void;
  children: ReactNode;
}

export function FullScreenModal({
  visible,
  onRequestClose,
  onEntered,
  onExited,
  children,
}: FullScreenModalProps) {
  const styles = useStyles(make);
  const reduced = useReducedMotion();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);

  // Keep the full rest height across Android adjustResize shrinks so dismissing
  // the keyboard mid-close never rebuilds the native interpolation nodes.
  const restHeightRef = useRef(height);
  if (height > restHeightRef.current) restHeightRef.current = height;
  const extent = Math.max(restHeightRef.current, height, 1);

  const progress = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(false);
  const wasVisibleRef = useRef(false);
  const visibleRef = useRef(visible);
  const onCloseRef = useRef(onRequestClose);
  const onEnteredRef = useRef(onEntered);
  const onExitedRef = useRef(onExited);

  visibleRef.current = visible;
  onCloseRef.current = onRequestClose;
  onEnteredRef.current = onEntered;
  onExitedRef.current = onExited;

  useEffect(() => {
    const opening = visible && !wasVisibleRef.current;
    wasVisibleRef.current = visible;

    if (visible) {
      if (opening) Keyboard.dismiss();
      const midClose = mountedRef.current;
      mountedRef.current = true;
      setMounted(true);

      if (reduced) {
        progress.setValue(1);
        onEnteredRef.current?.();
        return;
      }

      let spring: Animated.CompositeAnimation | null = null;
      const startOpen = () => {
        spring = Animated.spring(progress, {
          toValue: 1,
          ...SCREEN_SPRING.open,
          useNativeDriver: true,
        });
        spring.start(({ finished }) => {
          if (finished && visibleRef.current) onEnteredRef.current?.();
        });
      };

      // Reopening mid-close continues immediately from the current position and
      // velocity; opening from rest lets the subtree paint one off-screen frame
      // first so layout never competes with the first frame of travel (#69).
      if (midClose) {
        startOpen();
        return () => spring?.stop();
      }

      progress.setValue(0);
      const frame = requestAnimationFrame(startOpen);
      return () => {
        cancelAnimationFrame(frame);
        spring?.stop();
      };
    }

    if (!mountedRef.current) return;

    // Hide the keyboard before sliding down so it does not linger until unmount.
    Keyboard.dismiss();

    if (reduced) {
      progress.setValue(0);
      mountedRef.current = false;
      setMounted(false);
      onExitedRef.current?.();
      return;
    }

    const spring = Animated.spring(progress, {
      toValue: 0,
      ...SCREEN_SPRING.close,
      useNativeDriver: true,
    });
    spring.start(({ finished }) => {
      if (finished && !visibleRef.current) {
        mountedRef.current = false;
        setMounted(false);
        onExitedRef.current?.();
      }
    });
    return () => spring.stop();
  }, [visible, reduced, progress]);

  const active = visible || mounted;

  // Stay subscribed throughout the exit slide too so a second back press during
  // the ~300 ms close cannot punch through to the screen underneath (#66/#68).
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (visibleRef.current) onCloseRef.current();
      return true;
    });
    return () => sub.remove();
  }, [active]);

  const { scrimOpacity, translateY, sheetOpacity } = useMemo(
    () => ({
      scrimOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
      translateY: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [slideOffsetPx(0, extent), slideOffsetPx(1, extent)],
        extrapolate: 'clamp',
      }),
      sheetOpacity: progress.interpolate({
        inputRange: [0, 0.001, 1],
        outputRange: [0, 1, 1],
        extrapolate: 'clamp',
      }),
    }),
    [progress, extent],
  );

  if (!active) return null;

  return (
    <View style={styles.wrapper} pointerEvents="auto">
      <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => {}} accessible={false} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            opacity: sheetOpacity,
            transform: [{ translateY }],
          },
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    wrapper: {
      ...StyleSheet.absoluteFill,
      zIndex: 50,
      elevation: 24,
    },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(20, 28, 36, 0.5)',
    },
    sheet: {
      ...StyleSheet.absoluteFill,
      backgroundColor: t.ground,
    },
  });
