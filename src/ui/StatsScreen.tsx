import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { evaluateAchievements, levelFor, type Achievement, type Tier } from '../progress/achievements';
import { database } from '../store/database';
import { buildSummary, getCachedSummary, type Summary } from '../store/summary';
import { compareToLandmark, formatEarthShare } from './earth';
import { barTransform, countUpValue, CURVE, DURATION } from './motion';
import { useReducedMotion } from './useReducedMotion';
import { formatArea, formatByUnit, formatDistance, rejectionLabel } from './format';
import { radius, theme } from './theme';
import type { RecorderState } from './useRecorder';

export const StatsScreen = memo(function StatsScreen({
  recorder,
  active,
}: {
  recorder: RecorderState;
  active: boolean;
}) {
  const [summary, setSummary] = useState<Summary | null>(() => getCachedSummary());
  const [run, setRun] = useState(0);
  const wasActive = useRef(active);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const driver = await database();
      const next = await buildSummary(driver);
      if (!cancelled) setSummary(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [recorder.distanceMeters, recorder.exploredSquareMeters]);

  // Every screen in this app stays mounted, so "on mount" would mean counting
  // up unseen behind another tab. The bars and digits run when this screen
  // becomes the one being looked at.
  useEffect(() => {
    if (active && !wasActive.current) setRun((n) => n + 1);
    wasActive.current = active;
  }, [active]);

  if (!summary) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>讀取中…</Text>
      </View>
    );
  }

  const level = levelFor(summary);
  const achievements = evaluateAchievements(summary);
  const earned = achievements.reduce((total, a) => total + a.earned, 0);
  const available = achievements.reduce((total, a) => total + a.tiers.length, 0);
  const landmark = compareToLandmark(summary.exploredSquareMeters);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>探索</Text>

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
        <AnimatedBar value={level.progress} colour={theme.accent} run={run} />
        <Text style={styles.levelHint}>
          {level.nextLevelAtSquareMeters === null
            ? '已達最高等級'
            : `再探索 ${formatArea(level.nextLevelAtSquareMeters - summary.exploredSquareMeters)} 升級`}
        </Text>
      </View>

      <View style={styles.earthCard}>
        <Text style={styles.earthLabel}>佔地球表面</Text>
        <RollingNumber
          value={summary.exploredSquareMeters}
          format={formatEarthShare}
          run={run}
          style={styles.earthValue}
        />
        {landmark ? <Text style={styles.earthHint}>{landmark}</Text> : null}
      </View>

      <View style={styles.grid}>
        <Metric
          label="已探索面積"
          value={
            <RollingNumber
              value={summary.exploredSquareMeters}
              format={formatArea}
              run={run}
              style={styles.metricValue}
              fit
            />
          }
        />
        <Metric
          label="累計距離"
          value={
            <RollingNumber
              value={summary.distanceMeters}
              format={formatDistance}
              run={run}
              style={styles.metricValue}
              fit
            />
          }
        />
        <Metric label="到過的國家" value={`${summary.countries}`} />
        <Metric label="到過的城市" value={`${summary.cities}`} />
        <Metric label="記錄天數" value={`${summary.dayCount}`} />
        <Metric label="最長連續" value={`${summary.longestStreakDays} 天`} />
        <Metric label="單日最遠" value={formatDistance(summary.maxDayDistanceMeters)} />
        <Metric label="離起點最遠" value={formatDistance(summary.farthestFromStartMeters)} />
        <Metric label="探索磚格" value={`${summary.tileCount}`} />
        <Metric label="首次記錄" value={formatDay(summary.firstRecordedAt)} />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>成就</Text>
        <Text style={styles.sectionCount}>
          {earned} / {available}
        </Text>
      </View>

      {achievements.map((achievement) => (
        <AchievementRow key={achievement.id} achievement={achievement} run={run} />
      ))}

      <RejectionNotice recorder={recorder} />
    </ScrollView>
  );
});

/**
 * Fixes the gatekeeper refused today.
 *
 * Kept off the map, where it was noise, but kept somewhere: if a rule is ever
 * too strict this line is the only clue that fog stopped clearing on purpose
 * rather than by accident.
 */
function RejectionNotice({ recorder }: { recorder: RecorderState }) {
  if (recorder.rejections.length === 0) return null;

  const total = recorder.rejections.reduce((sum, r) => sum + r.count, 0);

  return (
    <View style={styles.rejections}>
      <Text style={styles.rejectionTitle}>今日已忽略 {total} 筆定位</Text>
      {recorder.rejections.map((rejection) => (
        <Text key={rejection.reason} style={styles.rejectionRow}>
          {rejectionLabel(rejection.reason)} · {rejection.count}
        </Text>
      ))}
    </View>
  );
}

/**
 * One number in the grid.
 *
 * The value is pinned to a single line and allowed to shrink instead: an area
 * like "0.0580 km²" is the widest thing here, and letting it wrap made its card
 * taller than the two beside it, which knocked the whole grid out of line.
 */
function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.metric}>
      {typeof value === 'string' ? (
        <Text
          style={styles.metricValue}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {value}
        </Text>
      ) : (
        value
      )}
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const TIER_COLOURS = [theme.bronze, theme.silver, theme.gold];

/**
 * One achievement, with its three tiers.
 *
 * The bar tracks the tier being worked on rather than the whole set, so it
 * refills twice on the way to gold instead of sitting near zero for years.
 */
function AchievementRow({ achievement, run }: { achievement: Achievement; run: number }) {
  const { earned, nextTarget, unit, value } = achievement;
  const complete = nextTarget === null;
  const barColour = TIER_COLOURS[Math.min(earned, TIER_COLOURS.length - 1)];

  return (
    <View style={[styles.achievement, earned > 0 && { borderColor: `${barColour}66` }]}>
      <View style={styles.achievementHead}>
        <Text style={[styles.achievementTitle, earned > 0 && styles.earnedTitle]}>
          {achievement.title}
        </Text>
        <View style={styles.medals}>
          {achievement.tiers.map((tier, index) => (
            <Medal key={tier.label} tier={tier} colour={TIER_COLOURS[index]} />
          ))}
        </View>
      </View>

      <Text style={styles.achievementDescription}>{achievement.description}</Text>

      <AnimatedBar value={achievement.progress} colour={barColour} run={run} />

      <Text style={styles.achievementProgress}>
        {complete
          ? `全部達成 · ${formatByUnit(value, unit)}`
          : `${formatByUnit(value, unit)} / ${formatByUnit(nextTarget, unit)}`}
      </Text>
    </View>
  );
}

function Medal({ tier, colour }: { tier: Tier; colour: string }) {
  return (
    <View
      style={[
        styles.medal,
        tier.unlocked ? { backgroundColor: colour, borderColor: colour } : styles.medalLocked,
      ]}
    >
      <Text style={[styles.medalText, tier.unlocked && styles.medalTextEarned]}>{tier.label}</Text>
    </View>
  );
}

/**
 * A bar that fills by scaling rather than by growing.
 *
 * Animating width would recalculate layout on the JS thread every frame. The
 * fill is laid out at full width and squeezed instead, which the native driver
 * runs on its own thread — see barTransform in motion.ts for the pivot maths.
 */
function AnimatedBar({ value, colour, run }: { value: number; colour: string; run: number }) {
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
      style={styles.track}
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

/**
 * A number that counts to its value.
 *
 * Text content cannot be driven natively, so this one does run on the JS
 * thread — which is why it is its own component. Only this Text re-renders per
 * frame, not the screen holding it, and only four numbers on the screen use it.
 */
function RollingNumber({
  value,
  format,
  run,
  style,
  fit = false,
}: {
  value: number;
  format: (value: number) => string;
  run: number;
  style: StyleProp<TextStyle>;
  fit?: boolean;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const runRef = useRef(run);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const arriving = runRef.current !== run;
    runRef.current = run;

    // Arriving on the screen counts up from nothing; a value that moved while
    // the screen was already open carries on from where the digits stood.
    const from = arriving ? 0 : shownRef.current;

    const settle = () => {
      shownRef.current = value;
      setShown(value);
    };

    if (reduced || from === value) {
      settle();
      return;
    }

    progress.setValue(0);
    const listener = progress.addListener(({ value: t }) => {
      const next = countUpValue(from, value, t);
      shownRef.current = next;
      setShown(next);
    });

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION.count,
      delay: arriving ? DURATION.page : 0,
      easing: Easing.bezier(...CURVE.enter),
      useNativeDriver: false,
    });

    animation.start(({ finished }) => {
      if (finished) settle();
    });

    return () => {
      animation.stop();
      progress.removeListener(listener);
    };
  }, [value, run, reduced, progress]);

  return (
    <Text
      style={style}
      numberOfLines={1}
      adjustsFontSizeToFit={fit}
      minimumFontScale={fit ? 0.6 : undefined}
    >
      {format(shown)}
    </Text>
  );
}

function formatDay(timestamp: number | null): string {
  if (timestamp === null) return '—';
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingTop: 64, paddingBottom: 40, gap: 14 },
  empty: { flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: theme.textFaint },

  title: { color: theme.text, fontSize: 26, fontWeight: '700', marginBottom: 4 },

  levelCard: {
    padding: 18,
    borderRadius: radius.panel,
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    gap: 12,
  },
  levelHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  levelLabel: { color: theme.textFaint, fontSize: 12, letterSpacing: 1 },
  levelValue: {
    color: theme.text,
    fontSize: 34,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  levelHint: { color: theme.textFaint, fontSize: 11 },

  earthCard: {
    padding: 18,
    borderRadius: radius.panel,
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    gap: 4,
  },
  earthLabel: { color: theme.textFaint, fontSize: 12, letterSpacing: 1 },
  earthValue: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  earthHint: { color: theme.accent, fontSize: 12 },

  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  // Full width and squeezed by transform; see AnimatedBar.
  fill: { height: 6, width: '100%', borderRadius: 3, backgroundColor: theme.accent },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Two columns, not three. On a 360dp screen three cards leave about 78dp of
  // text room each, which is narrower than "0.0580 km²" — the widest value
  // here — so it wrapped and threw the row heights out. Two columns give it
  // room to spare at a size worth reading.
  metric: {
    flexGrow: 1,
    flexBasis: '47%',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.card,
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  metricValue: {
    color: theme.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: { color: theme.textFaint, fontSize: 10, lineHeight: 14, marginTop: 4 },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 14,
  },
  sectionTitle: { color: theme.text, fontSize: 18, fontWeight: '700' },
  sectionCount: { color: theme.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },

  achievement: {
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    gap: 8,
  },
  achievementHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  achievementTitle: { color: theme.textFaint, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  earnedTitle: { color: theme.text },
  achievementDescription: { color: theme.textFaint, fontSize: 11, marginTop: -4 },
  achievementProgress: {
    color: theme.textFaint,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    marginTop: -2,
  },

  medals: { flexDirection: 'row', gap: 5 },
  medal: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  medalLocked: { backgroundColor: 'transparent', borderColor: theme.tierLocked },
  medalText: { color: theme.tierLocked, fontSize: 11, fontWeight: '700' },
  // Dark ink on the metal, so bronze/silver/gold each stay legible.
  medalTextEarned: { color: '#1a1205' },

  rejections: {
    marginTop: 8,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 207, 141, 0.28)',
    gap: 4,
  },
  rejectionTitle: { color: theme.warn, fontSize: 12, fontWeight: '600' },
  rejectionRow: { color: theme.textFaint, fontSize: 11, fontVariant: ['tabular-nums'] },
});
