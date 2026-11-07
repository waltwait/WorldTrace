import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';
import type { TrackSegment } from '../export/gpx';
import { database } from '../store/database';
import { getCachedDays, listDays, loadTrack, type TrackDay } from '../store/track';
import { Icon } from './Icon';
import { PressScale } from './PressScale';
import { useStyles, useTheme } from './ThemeProvider';
import { radius, TOOLBAR_CLEARANCE, type Theme } from './themes';
import { dayTitle, groupDaysByMonth, timeSpan } from './trackDays';
import { Text } from './Text';

export interface TimelineScreenProps {
  /** Hand a day's track to the map for review. */
  onSelectDay: (label: string, segments: TrackSegment[]) => void;
  /** Whether this is the page being looked at. */
  active: boolean;
}

export const TimelineScreen = memo(function TimelineScreen({
  onSelectDay,
  active,
}: TimelineScreenProps) {
  const styles = useStyles(make);
  const t = useTheme();
  const [days, setDays] = useState<TrackDay[] | null>(() => getCachedDays());
  const [busy, setBusy] = useState<string | null>(null);

  // Every time the page comes back rather than once: it stays mounted, and a day
  // walked since it opened would otherwise not be there.
  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    (async () => {
      const driver = await database();
      const next = await listDays(driver);
      if (!cancelled) setDays(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [active]);

  const open = useCallback(
    async (day: TrackDay) => {
      setBusy(day.date);
      try {
        const driver = await database();
        const segments = await loadTrack(driver, { from: day.from, to: day.to });
        onSelectDay(dayTitle(day.date, new Date()), segments);
      } finally {
        setBusy(null);
      }
    },
    [onSelectDay],
  );

  const sections = useMemo(() => groupDaysByMonth(days ?? [], new Date()), [days]);

  // A list, not a column of every day: a year of daily walks is hundreds of
  // rows, and building them all at once put them all on the JS thread at the
  // moment the tab opened.
  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(day) => day.date}
      extraData={busy}
      stickySectionHeadersEnabled={false}
      initialNumToRender={12}
      windowSize={7}
      maxToRenderPerBatch={8}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>足跡</Text>
          {days === null ? <Text style={styles.hint}>讀取中…</Text> : null}
          {days?.length === 0 ? <Text style={styles.hint}>還沒有任何記錄</Text> : null}
        </View>
      }
      renderSectionHeader={({ section }) => <Text style={styles.month}>{section.title}</Text>}
      renderItem={({ item: day, index, section }) => (
        <PressScale
          style={[
            styles.day,
            index === 0 && styles.dayFirst,
            index === section.data.length - 1 && styles.dayLast,
          ]}
          onPress={() => void open(day)}
        >
          <View>
            <Text style={styles.dayTitle}>{dayTitle(day.date, new Date())}</Text>
            <Text style={styles.daySpan}>{timeSpan(day.from, day.to)}</Text>
          </View>
          {busy === day.date ? (
            <ActivityIndicator size="small" color={t.muted} />
          ) : (
            <Icon name="chevronRight" color={t.muted} size={18} />
          )}
        </PressScale>
      )}
    />
  );
});

const make = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: TOOLBAR_CLEARANCE + 16 },
    header: { gap: 8, paddingHorizontal: 6, marginBottom: 8 },
    title: { color: t.ink, fontSize: 34, fontWeight: '900' },
    hint: { color: t.muted, fontSize: 15 },
    month: {
      color: t.muted,
      fontSize: 14,
      paddingHorizontal: 8,
      paddingTop: 14,
      paddingBottom: 8,
    },
    day: {
      minHeight: 62,
      paddingHorizontal: 16,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.soft,
      borderTopWidth: 1,
      borderTopColor: t.ground,
    },
    dayFirst: {
      borderTopWidth: 0,
      borderTopLeftRadius: radius.group,
      borderTopRightRadius: radius.group,
    },
    dayLast: { borderBottomLeftRadius: radius.group, borderBottomRightRadius: radius.group },
    dayTitle: { color: t.ink, fontSize: 16, fontWeight: '700' },
    daySpan: { color: t.muted, fontSize: 13, marginTop: 2 },
  });
