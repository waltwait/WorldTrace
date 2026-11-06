import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AIRPORTS_DB, findAirport } from '../flights/airports';
import { computePassportStats } from '../flights/flightStats';
import type { FlightRecord, PassportStats } from '../flights/types';
import type { TrackSegment } from '../export/gpx';
import { database } from '../store/database';
import { listFlights } from '../store/flights';
import { BackupScreen } from './BackupScreen';
import { PressScale } from './PressScale';
import { StatsScreen } from './StatsScreen';
import { TimelineScreen } from './TimelineScreen';
import { radius, theme } from './theme';
import type { RecorderState } from './useRecorder';

export type ProfileSubTab = 'explore' | 'timeline' | 'backup';

export interface ProfileScreenProps {
  recorder: RecorderState;
  active: boolean;
  onSelectDay: (label: string, segments: TrackSegment[]) => void;
}

function getCountryInfo(code: string): { name: string; flag: string } {
  for (const info of Object.values(AIRPORTS_DB)) {
    if (info.countryCode === code) {
      return { name: info.country, flag: info.flagEmoji };
    }
  }
  return { name: code, flag: '🌍' };
}

function getTopAirline(flights: FlightRecord[]): { name: string; count: number } | null {
  if (flights.length === 0) return null;
  const counts = new Map<string, number>();
  for (const f of flights) {
    const name = f.airlineName || f.airlineCode;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return sorted[0] ? { name: sorted[0][0], count: sorted[0][1] } : null;
}

export const ProfileScreen = memo(function ProfileScreen({
  recorder,
  active,
  onSelectDay,
}: ProfileScreenProps) {
  const [subTab, setSubTab] = useState<ProfileSubTab>('explore');
  const [flights, setFlights] = useState<FlightRecord[]>([]);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const refreshPassport = useCallback(async () => {
    try {
      const db = await database();
      const all = await listFlights(db);
      setFlights(all);
    } catch {
      // Ignore background refresh errors
    }
  }, []);

  useEffect(() => {
    if (active) {
      void refreshPassport();
    }
  }, [active, refreshPassport]);

  const passport: PassportStats = computePassportStats(flights);
  const topAirline = useMemo(() => getTopAirline(flights), [flights]);
  const homeAirport = passport.topAirportIata ? findAirport(passport.topAirportIata) : null;

  return (
    <View style={styles.screen}>
      {/* Top Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      {/* Flight Passport Card */}
      <View style={styles.passportCard}>
        <View style={styles.passportHeader}>
          <View style={styles.passportTagRow}>
            <Text style={styles.passportTag}>WORLDTRACE FLIGHT PASSPORT</Text>
          </View>
          <Text style={styles.passportIcon}>✈️</Text>
        </View>

        {/* 4 Key Flight Metrics */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>{passport.totalFlights}</Text>
            <Text style={styles.metricLabel}>FLIGHTS</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>{passport.totalHours}</Text>
            <Text style={styles.metricLabel}>HOURS</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>
              {passport.totalMiles.toLocaleString()}
            </Text>
            <Text style={styles.metricLabel}>MI</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>{passport.visitedCountriesCount}</Text>
            <Text style={styles.metricLabel}>COUNTRIES</Text>
          </View>
        </View>

        {/* Visited Airports Row */}
        {passport.airportVisits.length > 0 ? (
          <View style={styles.airportsRow}>
            <Text style={styles.airportsLabel}>AIRPORTS:</Text>
            <View style={styles.airportsBadges}>
              {passport.airportVisits.slice(0, 5).map((item) => (
                <View key={item.iata} style={styles.airportSignBadge}>
                  <Text style={styles.airportSignText}>
                    {item.iata} ({item.count})
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Expandable Flight Stats & Country Stamps */}
        <PressScale
          style={styles.expandStatsBtn}
          onPress={() => setDetailsExpanded((v) => !v)}
          hitSlop={6}
        >
          <Text style={styles.expandStatsText}>
            {detailsExpanded ? '收合飛行細節與印章 ▲' : '展開飛行細節與國家印章 ▼'}
          </Text>
        </PressScale>

        {detailsExpanded ? (
          <View style={styles.detailsBox}>
            {topAirline ? (
              <View style={styles.detailItemRow}>
                <Text style={styles.detailItemLabel}>最常搭乘：</Text>
                <Text style={styles.detailItemValue}>
                  {topAirline.name} ({topAirline.count} 趟)
                </Text>
              </View>
            ) : null}

            {homeAirport ? (
              <View style={styles.detailItemRow}>
                <Text style={styles.detailItemLabel}>主場機場：</Text>
                <Text style={styles.detailItemValue}>
                  {homeAirport.cityZh ?? homeAirport.city} ({homeAirport.iata})
                </Text>
              </View>
            ) : null}

            <View style={styles.stampsSection}>
              <Text style={styles.stampsTitle}>數位國家印章 (Country Stamps)</Text>
              {passport.visitedCountryCodes.length === 0 ? (
                <Text style={styles.stampsEmpty}>完成飛行記錄後解鎖國家印章</Text>
              ) : (
                <View style={styles.stampsGrid}>
                  {passport.visitedCountryCodes.map((code) => {
                    const country = getCountryInfo(code);
                    return (
                      <View key={code} style={styles.stampBadge}>
                        <Text style={styles.stampFlag}>{country.flag}</Text>
                        <Text style={styles.stampName}>{country.name}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        ) : null}
      </View>

      {/* Segmented Subtab Switcher */}
      <View style={styles.tabSwitcher}>
        <PressScale
          containerStyle={styles.tabSlot}
          style={[styles.tabSegment, subTab === 'explore' && styles.tabSegmentActive]}
          onPress={() => setSubTab('explore')}
        >
          <Text style={[styles.tabText, subTab === 'explore' && styles.tabTextActive]}>
            Explore
          </Text>
        </PressScale>

        <PressScale
          containerStyle={styles.tabSlot}
          style={[styles.tabSegment, subTab === 'timeline' && styles.tabSegmentActive]}
          onPress={() => setSubTab('timeline')}
        >
          <Text style={[styles.tabText, subTab === 'timeline' && styles.tabTextActive]}>
            Timeline
          </Text>
        </PressScale>

        <PressScale
          containerStyle={styles.tabSlot}
          style={[styles.tabSegment, subTab === 'backup' && styles.tabSegmentActive]}
          onPress={() => setSubTab('backup')}
        >
          <Text style={[styles.tabText, subTab === 'backup' && styles.tabTextActive]}>
            Backup
          </Text>
        </PressScale>
      </View>

      {/* Subtab Content View */}
      <View style={styles.subContent}>
        {subTab === 'explore' ? (
          <StatsScreen
            recorder={recorder}
            active={active && subTab === 'explore'}
            hideTitle
          />
        ) : null}

        {subTab === 'timeline' ? (
          <TimelineScreen onSelectDay={onSelectDay} hideTitle />
        ) : null}

        {subTab === 'backup' ? <BackupScreen hideTitle /> : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
    paddingTop: 64,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  title: {
    color: theme.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  passportCard: {
    marginHorizontal: 20,
    marginBottom: 14,
    padding: 16,
    borderRadius: radius.panel,
    backgroundColor: '#26235b',
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.35)',
    shadowColor: '#3d3899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
    gap: 12,
  },
  passportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  passportTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  passportTag: {
    color: '#c7d2fe',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  passportIcon: {
    fontSize: 14,
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  metricItem: {
    gap: 3,
  },
  metricValue: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    color: '#a5b4fc',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  airportsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
  },
  airportsLabel: {
    color: '#a5b4fc',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  airportsBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  airportSignBadge: {
    backgroundColor: theme.airportSignBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sign,
  },
  airportSignText: {
    color: theme.airportSignText,
    fontSize: 10,
    fontWeight: '800',
  },
  expandStatsBtn: {
    alignSelf: 'center',
    paddingVertical: 4,
  },
  expandStatsText: {
    color: '#c7d2fe',
    fontSize: 11,
    fontWeight: '700',
  },
  detailsBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: radius.card - 2,
    padding: 12,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  detailItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailItemLabel: {
    color: '#a5b4fc',
    fontSize: 11,
    fontWeight: '600',
  },
  detailItemValue: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  stampsSection: {
    marginTop: 4,
    gap: 6,
  },
  stampsTitle: {
    color: '#e0e7ff',
    fontSize: 11,
    fontWeight: '800',
  },
  stampsEmpty: {
    color: '#a5b4fc',
    fontSize: 11,
    fontStyle: 'italic',
  },
  stampsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stampBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: radius.sign,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#e8c25a',
  },
  stampFlag: {
    fontSize: 12,
  },
  stampName: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  tabSwitcher: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 3,
    borderRadius: radius.card,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    gap: 4,
  },
  tabSlot: {
    flex: 1,
  },
  tabSegment: {
    paddingVertical: 8,
    borderRadius: radius.card - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSegmentActive: {
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accent,
  },
  tabText: {
    color: theme.textFaint,
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: theme.text,
    fontWeight: '700',
  },
  subContent: {
    flex: 1,
  },
});
