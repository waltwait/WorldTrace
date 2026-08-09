import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { autoBackUp } from './src/cloud/cloudBackup';
import type { TrackSegment } from './src/export/gpx';
import { resolvePlaces } from './src/places/resolvePlaces';
import { database } from './src/store/database';
import { BackupScreen } from './src/ui/BackupScreen';
import { DialogHost } from './src/ui/DialogHost';
import { MapScreen } from './src/ui/MapScreen';
import { StatsScreen } from './src/ui/StatsScreen';
import { theme } from './src/ui/theme';
import { TimelineScreen } from './src/ui/TimelineScreen';
import { useRecorder } from './src/ui/useRecorder';

const TABS = ['地圖', '探索', '時間軸', '備份'] as const;

/**
 * Backs up in the background when the app comes to the foreground.
 *
 * Foreground rather than on a timer: a scheduled job would have to hold a
 * Google session alive in a context that gets torn down constantly, and the
 * schedule itself already refuses to upload more than once every few hours. If
 * it fails — offline, signed out, token expired — it stays quiet. A backup
 * failing is not something to interrupt someone's walk over, and the Backup
 * screen shows the real state whenever they look.
 */
function useAutomaticBackup(): void {
  useEffect(() => {
    let running = false;

    async function attempt() {
      if (running) return;
      running = true;
      try {
        const driver = await database();
        // Naming ground first: it is cheap, it needs no account, and it is what
        // the stats screen is waiting on. A backup that cannot run must not
        // stop it.
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

export default function App() {
  const { width } = useWindowDimensions();
  // The recorder lives here rather than inside MapScreen so that recording and
  // the fog snapshot survive moving between tabs.
  const recorder = useRecorder();
  const [index, setIndex] = useState(0);
  const [highlighted, setHighlighted] = useState<Highlight | null>(null);
  const pager = useRef<ScrollView>(null);

  useAutomaticBackup();

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(TABS.length - 1, next));
      setIndex(clamped);
      pager.current?.scrollTo({ x: clamped * width, animated: true });
    },
    [width],
  );

  /**
   * Sliding along the tab bar also changes page.
   *
   * On the map page a horizontal drag belongs to the map — panning it is the
   * whole point — so the pager never sees that gesture. This gives a way to
   * move between tabs that works everywhere.
   */
  const barGestures = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) < 40) return;
        setIndex((current) => {
          const next = Math.max(
            0,
            Math.min(TABS.length - 1, current + (gesture.dx < 0 ? 1 : -1)),
          );
          pager.current?.scrollTo({ x: next * width, animated: true });
          return next;
        });
      },
    }),
  ).current;

  function onPaged(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.round(event.nativeEvent.contentOffset.x / width);
    if (page !== index) setIndex(page);
  }

  function reviewDay(label: string, segments: TrackSegment[]) {
    setHighlighted({ label, segments });
    goTo(0);
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPaged}
        // Off on the map page. A horizontal ScrollView will happily intercept
        // drags from a native child, which would leave the map unpannable —
        // and panning the map is the point of the map. Leaving that page is
        // done from the tab bar instead, by tap or by sliding along it.
        scrollEnabled={index !== 0}
        style={styles.pager}
      >
        <View style={{ width }}>
          <MapScreen
            recorder={recorder}
            highlighted={highlighted}
            onClearHighlight={() => setHighlighted(null)}
          />
        </View>
        <View style={{ width }}>
          <StatsScreen recorder={recorder} />
        </View>
        <View style={{ width }}>
          <TimelineScreen onSelectDay={reviewDay} />
        </View>
        <View style={{ width }}>
          <BackupScreen />
        </View>
      </ScrollView>

      <View style={styles.tabBar} {...barGestures.panHandlers}>
        {TABS.map((label, tabIndex) => (
          <Pressable key={label} style={styles.tab} onPress={() => goTo(tabIndex)}>
            <Text style={[styles.tabLabel, index === tabIndex && styles.tabLabelActive]}>
              {label}
            </Text>
            <View style={[styles.tabIndicator, index !== tabIndex && styles.tabIndicatorIdle]} />
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
  pager: { flex: 1 },

  tabBar: {
    flexDirection: 'row',
    paddingTop: 16,
    paddingBottom: 10,
    backgroundColor: theme.surfaceSolid,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  tab: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 2 },
  tabLabel: { color: theme.textFaint, fontSize: 12, letterSpacing: 0.5 },
  tabLabelActive: { color: theme.text, fontWeight: '600' },
  tabIndicator: { width: 16, height: 2, borderRadius: 1, backgroundColor: theme.accent },
  // Kept in the tree rather than removed, so the row does not shift by 2px
  // every time the page changes.
  tabIndicatorIdle: { backgroundColor: 'transparent' },
});
