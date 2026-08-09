import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { evaluateAchievements, levelFor, type Achievement, type Tier } from '../progress/achievements';
import { database } from '../store/database';
import { buildSummary, type Summary } from '../store/summary';
import { compareToLandmark, formatEarthShare } from './earth';
import { formatArea, formatByUnit, formatDistance, rejectionLabel } from './format';
import { radius, theme } from './theme';
import type { RecorderState } from './useRecorder';

export function StatsScreen({ recorder }: { recorder: RecorderState }) {
  const [summary, setSummary] = useState<Summary | null>(null);

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
  }, []);

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
          <Text style={styles.levelValue}>{level.level}</Text>
        </View>
        <ProgressBar value={level.progress} />
        <Text style={styles.levelHint}>
          {level.nextLevelAtSquareMeters === null
            ? '已達最高等級'
            : `再探索 ${formatArea(level.nextLevelAtSquareMeters - summary.exploredSquareMeters)} 升級`}
        </Text>
      </View>

      <View style={styles.earthCard}>
        <Text style={styles.earthLabel}>佔地球表面</Text>
        <Text style={styles.earthValue}>{formatEarthShare(summary.exploredSquareMeters)}</Text>
        {landmark ? <Text style={styles.earthHint}>{landmark}</Text> : null}
      </View>

      <View style={styles.grid}>
        <Metric label="已探索面積" value={formatArea(summary.exploredSquareMeters)} />
        <Metric label="累計距離" value={formatDistance(summary.distanceMeters)} />
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
        <AchievementRow key={achievement.id} achievement={achievement} />
      ))}

      <RejectionNotice recorder={recorder} />
    </ScrollView>
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
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text
        style={styles.metricValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}
      </Text>
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
function AchievementRow({ achievement }: { achievement: Achievement }) {
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

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.round(achievement.progress * 100)}%`, backgroundColor: barColour },
          ]}
        />
      </View>

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

function ProgressBar({ value }: { value: number }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.round(value * 100)}%` }]} />
    </View>
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
  fill: { height: 6, borderRadius: 3, backgroundColor: theme.accent },

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
