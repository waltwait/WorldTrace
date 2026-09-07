import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { autoBackUp } from './src/cloud/cloudBackup';
import type { TrackSegment } from './src/export/gpx';
import { resolvePlaces } from './src/places/resolvePlaces';
import { database } from './src/store/database';
import { BackupScreen } from './src/ui/BackupScreen';
import { DialogHost } from './src/ui/DialogHost';
import { MapScreen } from './src/ui/MapScreen';
import { CURVE, DURATION } from './src/ui/motion';
import { pageSlide } from './src/ui/slide';
import { useReducedMotion } from './src/ui/useReducedMotion';
import { StatsScreen } from './src/ui/StatsScreen';
import { theme } from './src/ui/theme';
import { TimelineScreen } from './src/ui/TimelineScreen';
import { useRecorder } from './src/ui/useRecorder';

const TABS = ['地圖', '探索', '時間軸', '備份'] as const;

/**
 * Backs up in the background when the app comes to the foreground.
 */
function useAutomaticBackup(): void {
  useEffect(() => {
    let running = false;

    async function attempt() {
      if (running) return;
      running = true;
      try {
        const driver = await database();
        await resolvePlaces(driver).catch((error) =>
          console.warn('[WorldTrace] place lookup skipped', error),
        );
        await autoBackUp(driver);
      } catch (error) {
        console.warn('[WorldTrace] automatic backup skipped', error);
      } finally {
        running = false;
      }
    }

    void attempt();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void attempt();
    });

    return () => subscription.remove();
  }, []);
}

interface Highlight {
  label: string;
  segments: TrackSegment[];
}

/**
 * One page of the pager, moved by a native RenderThread transform.
 *
 * The container is an Animated.View in every state, hidden ones included. That
 * is load-bearing rather than tidy: React reconciles by element type, so
 * handing back a plain View while a page was hidden tore the entire subtree
 * down and rebuilt it on every switch — MapLibre's native map destroyed and
 * re-created, every screen's database effect run again. See slide.ts.
 */
function SlideScreen({
  tabIndex,
  activeIndex,
  prevIndex,
  slideDir,
  slideAnim,
  width,
  children,
}: {
  tabIndex: number;
  activeIndex: number;
  prevIndex: number | null;
  slideDir: 1 | -1;
  slideAnim: Animated.Value;
  width: number;
  children: React.ReactNode;
}) {
  const isCurrent = tabIndex === activeIndex;
  const slide = pageSlide(tabIndex, activeIndex, prevIndex, slideDir);

  const translateX = slide.animated
    ? slideAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [slide.from * width, slide.to * width],
      })
    : slide.from * width;

  // The page being left dims as it goes, which is most of what makes the
  // switch read as one screen giving way to another rather than a hard cut.
  const opacity = slide.animated
    ? slideAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [slide.opacityFrom, slide.opacityTo],
      })
    : slide.opacityFrom;

  return (
    <Animated.View
      style={[
        styles.page,
        {
          transform: [{ translateX }],
          zIndex: isCurrent ? 2 : slide.visible ? 1 : -1,
          opacity,
        },
      ]}
      pointerEvents={isCurrent ? 'auto' : 'none'}
    >
      {children}
    </Animated.View>
  );
}

export default function App() {
  const recorder = useRecorder();
  const [index, setIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [slideDir, setSlideDir] = useState<1 | -1>(1);
  const [highlighted, setHighlighted] = useState<Highlight | null>(null);

  const { width } = useWindowDimensions();
  const [barWidth, setBarWidth] = useState(width);
  const tabAnim = useRef(new Animated.Value(0)).current;
  // A transition owns its own value. Rewinding a shared one has to happen in
  // the tap handler, which lands a frame before React commits the new render —
  // long enough to drag the page still on screen a full width sideways.
  const [slideAnim, setSlideAnim] = useState(() => new Animated.Value(1));
  const runningSlide = useRef<Animated.Value | null>(null);
  const reducedMotion = useReducedMotion();

  useAutomaticBackup();

  const indexRef = useRef(index);
  indexRef.current = index;

  const goTo = useCallback(
    (next: number) => {
      const current = indexRef.current;
      const clamped = Math.max(0, Math.min(TABS.length - 1, next));
      if (clamped === current) return;

      setSlideDir(clamped > current ? 1 : -1);

      if (reducedMotion) {
        // No prev page, so nothing is left mid-flight: the new page renders
        // at rest and the old one is simply gone.
        runningSlide.current = null;
        tabAnim.setValue(clamped);
        setPrevIndex(null);
        setIndex(clamped);
        return;
      }

      const anim = new Animated.Value(0);
      runningSlide.current = anim;

      setPrevIndex(current);
      setIndex(clamped);
      setSlideAnim(anim);

      Animated.parallel([
        Animated.spring(tabAnim, {
          toValue: clamped,
          tension: 110,
          friction: 12,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 1,
          duration: DURATION.page,
          easing: Easing.bezier(...CURVE.move),
          useNativeDriver: true,
        }),
      ]).start(() => {
        // A tab tapped mid-slide cuts this animation short. Clearing prevIndex
        // then would yank away the page that newer transition is still
        // sliding out.
        if (runningSlide.current === anim) setPrevIndex(null);
      });
    },
    [tabAnim, reducedMotion],
  );

  const clearHighlight = useCallback(() => setHighlighted(null), []);

  const reviewDay = useCallback(
    (label: string, segments: TrackSegment[]) => {
      setHighlighted({ label, segments });
      goTo(0);
    },
    [goTo],
  );

  const tabWidth = barWidth / TABS.length;
  const indicatorWidth = 22;
  const indicatorLeft = (tabWidth - indicatorWidth) / 2;

  const indicatorTranslateX = tabAnim.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: [
      0 * tabWidth + indicatorLeft,
      1 * tabWidth + indicatorLeft,
      2 * tabWidth + indicatorLeft,
      3 * tabWidth + indicatorLeft,
    ],
  });

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Stacked screens with silky horizontal slide and persistent map memory */}
      <View style={styles.screens}>
        <SlideScreen
          tabIndex={0}
          activeIndex={index}
          prevIndex={prevIndex}
          slideDir={slideDir}
          slideAnim={slideAnim}
          width={width}
        >
          <MapScreen
            recorder={recorder}
            highlighted={highlighted}
            onClearHighlight={clearHighlight}
          />
        </SlideScreen>
        <SlideScreen
          tabIndex={1}
          activeIndex={index}
          prevIndex={prevIndex}
          slideDir={slideDir}
          slideAnim={slideAnim}
          width={width}
        >
          <StatsScreen recorder={recorder} active={index === 1} />
        </SlideScreen>
        <SlideScreen
          tabIndex={2}
          activeIndex={index}
          prevIndex={prevIndex}
          slideDir={slideDir}
          slideAnim={slideAnim}
          width={width}
        >
          <TimelineScreen onSelectDay={reviewDay} />
        </SlideScreen>
        <SlideScreen
          tabIndex={3}
          activeIndex={index}
          prevIndex={prevIndex}
          slideDir={slideDir}
          slideAnim={slideAnim}
          width={width}
        >
          <BackupScreen />
        </SlideScreen>
      </View>

      <View
        style={styles.tabBar}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      >
        <Animated.View
          style={[
            styles.activeIndicator,
            {
              width: indicatorWidth,
              transform: [{ translateX: indicatorTranslateX }],
            },
          ]}
        />
        {TABS.map((label, tabIndex) => (
          <Pressable
            key={label}
            hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.5 }]}
            onPress={() => goTo(tabIndex)}
          >
            <Text style={[styles.tabLabel, index === tabIndex && styles.tabLabelActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Mounted once, at the root: anything in the app can ask a question
          without every screen in between having to pass a handler down. */}
      <DialogHost />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  screens: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  page: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.background,
  },

  tabBar: {
    position: 'relative',
    flexDirection: 'row',
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: theme.surfaceSolid,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  tabLabel: { color: theme.textFaint, fontSize: 12, letterSpacing: 0.5 },
  tabLabelActive: { color: theme.text, fontWeight: '600' },
  activeIndicator: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    height: 2.5,
    borderRadius: 1.5,
    backgroundColor: theme.accent,
  },
});

