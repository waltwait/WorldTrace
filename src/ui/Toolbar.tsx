/** The floating toolbar: three pages, and the one action that matters from any of them. */

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { CURVE, DURATION, pillOffset } from './motion';
import { pagerStops } from './pager';
import { PressScale } from './PressScale';
import { useTheme } from './ThemeProvider';
import { radius } from './themes';
import { useReducedMotion } from './useReducedMotion';

export const TABS: ReadonlyArray<{ label: string; icon: IconName }> = [
  { label: '總覽', icon: 'home' },
  { label: '航班', icon: 'plane' },
  { label: '設定', icon: 'gear' },
];

const TAB_WIDTH = 56;
const TAB_GAP = 4;
const BAR_PADDING = 6;
const TAB_STEP = TAB_WIDTH + TAB_GAP;

export function Toolbar({
  active,
  scrollX,
  pageWidth = 0,
  hidden = false,
  onSelect,
  onAdd,
}: {
  active: number;
  scrollX?: Animated.Value;
  pageWidth?: number;
  hidden?: boolean;
  onSelect: (index: number) => void;
  onAdd: () => void;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const visibility = useRef(new Animated.Value(hidden ? 0 : 1)).current;

  useEffect(() => {
    const target = hidden ? 0 : 1;
    if (reduced) {
      visibility.setValue(target);
      return;
    }

    const animation = Animated.timing(visibility, {
      toValue: target,
      duration: hidden ? DURATION.exit : DURATION.enter,
      easing: Easing.bezier(...CURVE.enter),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [hidden, reduced, visibility]);

  const stops = !reduced && scrollX ? pagerStops(pageWidth, TABS.length, TAB_STEP) : null;
  const indicatorX =
    stops && scrollX
      ? scrollX.interpolate({ ...stops, extrapolate: 'clamp' })
      : pillOffset(active, TAB_WIDTH, TAB_GAP);

  const barShift = visibility.interpolate({
    inputRange: [0, 1],
    outputRange: [24, 0],
  });

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          opacity: visibility,
          transform: [{ translateY: barShift }],
        },
      ]}
      pointerEvents={hidden ? 'none' : 'box-none'}
    >
      <View style={[styles.tabs, { backgroundColor: t.ink }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            { backgroundColor: t.accent, transform: [{ translateX: indicatorX }] },
          ]}
        />
        {TABS.map((tab, index) => (
          <PressScale
            key={tab.label}
            style={styles.tab}
            onPress={() => onSelect(index)}
            label={tab.label}
          >
            <Icon name={tab.icon} color={index === active ? t.ink : '#FFFFFF'} />
          </PressScale>
        ))}
      </View>
      <PressScale style={[styles.add, { backgroundColor: t.accent }]} onPress={onAdd} label="新增航班">
        <Icon name="plus" color={t.ink} size={26} />
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  tabs: { flexDirection: 'row', gap: TAB_GAP, padding: BAR_PADDING, borderRadius: radius.round },
  indicator: {
    position: 'absolute',
    left: BAR_PADDING,
    top: BAR_PADDING,
    width: TAB_WIDTH,
    height: 48,
    borderRadius: 24,
  },
  tab: {
    width: TAB_WIDTH,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
