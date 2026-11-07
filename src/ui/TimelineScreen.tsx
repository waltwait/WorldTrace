import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import type { TrackSegment } from '../export/gpx';
import { database } from '../store/database';
import { getCachedDays, listDays, loadTrack, type TrackDay } from '../store/track';
import { FadeIn } from './FadeIn';
import { staggerDelay } from './motion';
import { PressScale } from './PressScale';
import { radius, theme } from './theme';

export interface TimelineScreenProps {
  /** Hand a day's track to the map for review. */
  onSelectDay: (label: string, segments: TrackSegment[]) => void;
  hideTitle?: boolean;
}

export const TimelineScreen = memo(function TimelineScreen({
  onSelectDay,
  hideTitle = false,
}: TimelineScreenProps) {
  const [days, setDays] = useState<TrackDay[] | null>(() => getCachedDays());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const driver = await database();
      const next = await listDays(driver);
      if (!cancelled) setDays(next);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const open = useCallback(
    async (day: TrackDay) => {
      setBusy(day.date);
      try {
        const driver = await database();
        const segments = await loadTrack(driver, { from: day.from, to: day.to });
        onSelectDay(day.date, segments);
      } finally {
        setBusy(null);
      }
    },
    [onSelectDay],
  );

  const renderDay = useCallback(
    ({ item: day, index }: { item: TrackDay; index: number }) => {
      const row = (
        <PressScale style={styles.day} onPress={() => void open(day)}>
          <View style={styles.dayText}>
            <Text style={styles.dayDate}>{day.date}</Text>
            <Text style={styles.dayMeta}>
              {day.pointCount} 個定位點 · {formatSpan(day.from, day.to)}
            </Text>
          </View>
          <View style={styles.dayEnd}>
            {busy === day.date ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : (
              <Text style={styles.chevron}>›</Text>
            )}
          </View>
        </PressScale>
      );

      // Only the first screenful arrives with a flourish. Rows further down are
      // made as they scroll into reach, and animating each of those would be a
      // new animation for every swipe.
      return index < ANIMATED_ROWS ? (
        <FadeIn delay={staggerDelay(index)}>{row}</FadeIn>
      ) : (
        row
      );
    },
    [busy, open],
  );

  // A list, not a column of every day: a year of daily walks is hundreds of
  // cards, and building them all at once put them all on the JS thread at the
  // moment the tab opened.
  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, hideTitle && styles.contentCompact]}
      data={days ?? []}
      keyExtractor={(day) => day.date}
      renderItem={renderDay}
      extraData={busy}
      ItemSeparatorComponent={Separator}
      initialNumToRender={ANIMATED_ROWS}
      windowSize={7}
      maxToRenderPerBatch={8}
      ListHeaderComponent={
        <View style={[styles.header, hideTitle && styles.headerCompact]}>
          {!hideTitle ? <Text style={styles.title}>時間軸</Text> : null}

          {days === null ? <Text style={styles.hint}>讀取中…</Text> : null}

          {days?.length === 0 ? (
            <Text style={styles.hint}>還沒有任何記錄</Text>
          ) : null}
        </View>
      }
    />
  );
});

const ANIMATED_ROWS = 12;

function Separator() {
  return <View style={styles.separator} />;
}

function formatSpan(from: number, to: number): string {
  const time = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return `${time(from)}–${time(to)}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingTop: 64, paddingBottom: 40 },
  contentCompact: { paddingTop: 12 },
  header: { gap: 10, marginBottom: 14 },
  headerCompact: { marginBottom: 6 },
  separator: { height: 10 },
  title: { color: theme.text, fontSize: 26, fontWeight: '700', marginBottom: 4 },
  hint: { color: theme.textFaint, fontSize: 13, lineHeight: 20 },

  day: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  dayText: { gap: 3 },
  dayDate: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dayMeta: { color: theme.textFaint, fontSize: 11, fontVariant: ['tabular-nums'] },
  // The same width whether it holds the words or the spinner, so the row does not
  // change shape when a day is tapped.
  dayEnd: { minWidth: 76, height: 20, alignItems: 'flex-end', justifyContent: 'center' },
  chevron: { color: theme.accent, fontSize: 18 },
});
