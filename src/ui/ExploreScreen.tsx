/**
 * What the walking adds up to, opened from the numbers on the first page.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { evaluateAchievements, levelFor, type Achievement, type Tier } from '../progress/achievements';
import { database } from '../store/database';
import { buildSummary, getCachedSummary, type Summary } from '../store/summary';
import { compareToLandmark, formatEarthShare } from './earth';
import { formatArea, formatByUnit, formatDistance, rejectionLabel } from './format';
import { Icon } from './Icon';
import { barTransform, CURVE, DURATION } from './motion';
import { PressScale } from './PressScale';
import { RollingNumber } from './RollingNumber';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, radius, SHARED, type Theme } from './themes';
import { useReducedMotion } from './useReducedMotion';
import type { RecorderState } from './useRecorder';
import { Text } from './Text';

export const ExploreScreen = memo(function ExploreScreen({
  recorder,
  visible,
  onClose,
}: {
  recorder: RecorderState;
  visible: boolean;
  onClose: () => void;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const active = visible;
  const [summary, setSummary] = useState<Summary | null>(() => getCachedSummary());
  const [run, setRun] = useState(0);
  const wasActive = useRef(active);

  // Only while this is the screen being looked at. The numbers move every few
  // seconds on a walk, and rebuilding the summary reads the whole track; doing
  // that behind another tab is work nobody sees. Coming back runs it again, and
  // an unchanged summary comes straight from the cache.
  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    (async () => {
      const driver = await database();
      const next = await buildSummary(driver);
      if (!cancelled) setSummary(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, recorder.distanceMeters, recorder.exploredSquareMeters]);

  // Every screen in this app stays mounted once opened, so "on mount" would
  // mean counting up unseen behind another tab. The bars and digits run when
  // this screen becomes the one being looked at.
  useEffect(() => {
    if (active && !wasActive.current) setRun((n) => n + 1);
    wasActive.current = active;
  }, [active]);

  // The first visit is the one that cannot rely on that: the screen is mounted
  // already active, and its numbers only exist once the summary has loaded. Their
  // arrival is the signal instead, given once.
  const arrived = useRef(false);
  useEffect(() => {
    if (summary === null || arrived.current) return;
    arrived.current = true;
    if (active) setRun((n) => n + 1);
  }, [summary, active]);

  const level = summary ? levelFor(summary) : null;
  const achievements = summary ? evaluateAchievements(summary) : [];
  const landmark = summary ? compareToLandmark(summary.exploredSquareMeters) : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <PressScale style={styles.back} onPress={onClose} label="返回" hitSlop={8}>
            <Icon name="back" color={t.ink} />
          </PressScale>
          <Text style={styles.title}>探索</Text>
        </View>

        {summary && level ? (
          <>
            <View style={styles.levelCard}>
              <View style={styles.levelHeader}>
                <Text style={styles.levelLabel}>等級</Text>
                <RollingNumber
                  value={level.level}
                  format={(n) => String(Math.round(n))}
                  run={run}
                  style={styles.levelValue}
                />
              </View>
              <AnimatedBar value={level.progress} colour="#FFFFFF" run={run} onTile />
              <Text style={styles.levelLabel}>
                {level.nextLevelAtSquareMeters === null
                  ? '已達最高等級'
                  : `再探索 ${formatArea(level.nextLevelAtSquareMeters - summary.exploredSquareMeters)} 升級`}
              </Text>
            </View>

            <View style={styles.earth}>
              <Text style={styles.statLabel}>佔地球表面</Text>
              <RollingNumber
                value={summary.exploredSquareMeters}
                format={formatEarthShare}
                run={run}
                style={styles.earthValue}
              />
              {landmark ? <Text style={styles.statLabel}>{landmark}</Text> : null}
            </View>

            <View style={styles.stats}>
              <Stat label="面積" value={formatArea(summary.exploredSquareMeters)} />
              <Stat label="距離" value={formatDistance(summary.distanceMeters)} />
              <Stat label="國家" value={`${summary.countries}`} />
              <Stat label="城市" value={`${summary.cities}`} />
              <Stat label="記錄天數" value={`${summary.dayCount}`} />
              <Stat label="最長連續" value={`${summary.longestStreakDays} 天`} />
              <Stat label="單日最遠" value={formatDistance(summary.maxDayDistanceMeters)} />
              <Stat label="離起點最遠" value={formatDistance(summary.farthestFromStartMeters)} />
              <Stat label="首次記錄" value={formatDay(summary.firstRecordedAt)} />
            </View>

            <Text style={styles.heading}>成就</Text>
            <View style={styles.group}>
              {achievements.map((achievement, index) => (
                <AchievementRow
                  key={achievement.id}
                  achievement={achievement}
                  run={run}
                  first={index === 0}
                />
              ))}
            </View>

            <RejectionNotice recorder={recorder} />
          </>
        ) : (
          <Text style={styles.statLabel}>讀取中…</Text>
        )}
      </ScrollView>
    </Modal>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles(make);
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Fixes the gatekeeper refused today.
 *
 * Kept off the map, where it was noise, but kept somewhere: if a rule is ever
 * too strict this line is the only clue that fog stopped clearing on purpose
 * rather than by accident.
 */
function RejectionNotice({ recorder }: { recorder: RecorderState }) {
  const styles = useStyles(make);
  if (recorder.rejections.length === 0) return null;

  const total = recorder.rejections.reduce((sum, r) => sum + r.count, 0);

  return (
    <View style={styles.rejections}>
      <Text style={styles.rejectionTitle}>今日已忽略 {total} 筆定位</Text>
      {recorder.rejections.map((rejection) => (
        <Text key={rejection.reason} style={styles.rejectionRow}>
          {rejectionLabel(rejection.reason)}，{rejection.count} 筆
        </Text>
      ))}
    </View>
  );
}

const TIER_COLOURS = [SHARED.bronze, SHARED.silver, SHARED.gold];

/**
 * One achievement, with its three tiers.
 *
 * The bar tracks the tier being worked on rather than the whole set, so it
 * refills twice on the way to gold instead of sitting near zero for years.
 */
function AchievementRow({
  achievement,
  run,
  first,
}: {
  achievement: Achievement;
  run: number;
  first: boolean;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const { nextTarget, unit, value } = achievement;
  const complete = nextTarget === null;

  return (
    <View style={[styles.achievement, !first && styles.line]}>
      <View style={styles.achievementHead}>
        <Text style={styles.achievementTitle}>{achievement.title}</Text>
        <View style={styles.medals}>
          {achievement.tiers.map((tier, index) => (
            <Medal key={tier.label} tier={tier} colour={TIER_COLOURS[index]} />
          ))}
        </View>
      </View>

      <Text style={styles.statLabel}>{achievement.description}</Text>

      <AnimatedBar value={achievement.progress} colour={t.tile} run={run} />

      <Text style={styles.statLabel}>
        {complete
          ? `全部達成，${formatByUnit(value, unit)}`
          : `${formatByUnit(value, unit)} / ${formatByUnit(nextTarget, unit)}`}
      </Text>
    </View>
  );
}

function Medal({ tier, colour }: { tier: Tier; colour: string }) {
  const styles = useStyles(make);
  return (
    <View
      style={[styles.medal, { borderColor: colour }, tier.unlocked && { backgroundColor: colour }]}
    />
  );
}

/**
 * A bar that fills by scaling rather than by growing.
 *
 * Animating width would recalculate layout on the JS thread every frame. The
 * fill is laid out at full width and squeezed instead, which the native driver
 * runs on its own thread — see barTransform in motion.ts for the pivot maths.
 */
function AnimatedBar({
  value,
  colour,
  run,
  onTile = false,
}: {
  value: number;
  colour: string;
  run: number;
  onTile?: boolean;
}) {
  const styles = useStyles(make);
  const reduced = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const runRef = useRef(run);

  useEffect(() => {
    const arriving = runRef.current !== run;
    runRef.current = run;

    if (reduced) {
      progress.setValue(value);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: value,
      duration: DURATION.bar,
      // Let the page finish sliding in before the bars start filling: one
      // thing moves at a time.
      delay: arriving ? DURATION.page : 0,
      easing: Easing.bezier(...CURVE.enter),
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [value, run, reduced, progress]);

  return (
    <View
      style={[styles.track, onTile && styles.trackOnTile]}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            backgroundColor: colour,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [
                    barTransform(trackWidth, 0).translateX,
                    barTransform(trackWidth, 1).translateX,
                  ],
                }),
              },
              { scaleX: progress },
            ],
          },
        ]}
      />
    </View>
  );
}

function formatDay(timestamp: number | null): string {
  if (timestamp === null) return '—';
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

const make = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { paddingHorizontal: 16, paddingTop: 48, paddingBottom: 32, gap: 12 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    back: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { color: t.ink, fontSize: 30, fontWeight: '900' },
    heading: { color: t.muted, fontSize: 14, paddingHorizontal: 8, marginTop: 6 },

    levelCard: {
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderRadius: radius.ticket,
      backgroundColor: t.tile,
      gap: 8,
    },
    levelHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    levelLabel: { color: t.onTile, fontSize: 13 },
    levelValue: { color: '#FFFFFF', fontFamily: FONT.extraBold, fontSize: 34 },

    earth: { paddingHorizontal: 8, gap: 2 },
    earthValue: { color: t.ink, fontSize: 22, fontWeight: '700' },

    stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, paddingHorizontal: 8 },
    stat: { width: '33.33%', paddingRight: 8, gap: 2 },
    statLabel: { color: t.muted, fontSize: 13 },
    statValue: { color: t.ink, fontFamily: FONT.bold, fontSize: 20 },

    group: { borderRadius: radius.group, backgroundColor: t.soft, overflow: 'hidden' },
    line: { borderTopWidth: 1, borderTopColor: t.ground },

    track: { height: 6, borderRadius: 3, backgroundColor: t.ground, overflow: 'hidden' },
    trackOnTile: { backgroundColor: 'rgba(255,255,255,0.2)' },
    // Full width and squeezed by transform; see AnimatedBar.
    fill: { height: 6, width: '100%', borderRadius: 3 },

    achievement: { paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
    achievementHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    achievementTitle: { color: t.ink, fontSize: 15, fontWeight: '700', flexShrink: 1 },
    medals: { flexDirection: 'row', gap: 5 },
    medal: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },

    rejections: { padding: 14, borderRadius: radius.group, backgroundColor: t.soft, gap: 4 },
    rejectionTitle: { color: t.ink, fontSize: 14, fontWeight: '700' },
    rejectionRow: { color: t.muted, fontSize: 13 },
  });
