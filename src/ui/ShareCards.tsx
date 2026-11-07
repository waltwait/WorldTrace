/**
 * Fixed-size shareable card views rendered at 360×640 (9:16) or 360×450 (4:5)
 * and captured at 3× to 1080×1920 or 1080×1350 PNG.
 */

import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Line } from 'react-native-svg';
import {
  CARD_DIMENSIONS,
  type ShareTicketItem,
  type TripShareModel,
  type YearShareModel,
} from '../flights/shareCard';
import { ArcDiagram } from './ArcDiagram';
import { RouteLine } from './RouteLine';
import { Text } from './Text';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, radius, type Theme } from './themes';

export function TripShareCard({ model }: { model: TripShareModel }) {
  const styles = useStyles(make);
  const dim = CARD_DIMENSIONS[model.aspect];
  const isTall = model.aspect === '9:16';

  const arcHeight = isTall
    ? model.compactTickets
      ? 148
      : 184
    : model.tickets.length >= 3
      ? 90
      : 112;

  return (
    <View
      style={[
        styles.card,
        isTall ? styles.cardTall : styles.cardFeed,
        { width: dim.logicalWidth, height: dim.logicalHeight },
      ]}
    >
      <View style={isTall ? styles.bodyTall : styles.bodyFeed}>
        <View style={styles.tripHeadBlock}>
          <View style={styles.tripTitleRow}>
            {model.flags.length > 0 ? (
              <Text style={isTall ? styles.tripFlagTall : styles.tripFlagFeed}>
                {model.flags.join(' ')}
              </Text>
            ) : null}
            <Text
              style={[styles.tripTitle, isTall ? styles.tripTitleTall : styles.tripTitleFeed]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
            >
              {model.title}
            </Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {model.badge}
              </Text>
            </View>
          </View>
          <Text style={styles.tripDates} numberOfLines={1}>
            {model.dates}
          </Text>
        </View>

        <ArcDiagram
          flights={model.flights}
          width={320}
          height={arcHeight}
          connectGround
          showLabels
        />

        <View style={isTall ? styles.routeBoxTall : styles.routeBoxFeed}>
          <RouteLine steps={model.steps} fit />
        </View>

        <View style={isTall ? styles.ticketStackTall : styles.ticketStackFeed}>
          {model.tickets.map((ticket) => (
            <ShareTicket key={ticket.id} ticket={ticket} compact={model.compactTickets} />
          ))}
          {model.overflowCount > 0 ? (
            <View style={styles.overflowPill}>
              <Text style={styles.overflowText}>還有 {model.overflowCount} 段航班</Text>
            </View>
          ) : null}
        </View>
      </View>

      <CardFooter />
    </View>
  );
}

export function YearShareCard({ model }: { model: YearShareModel }) {
  const styles = useStyles(make);
  const dim = CARD_DIMENSIONS[model.aspect];
  const isTall = model.aspect === '9:16';

  return (
    <View
      style={[
        styles.card,
        isTall ? styles.cardTall : styles.cardFeed,
        { width: dim.logicalWidth, height: dim.logicalHeight },
      ]}
    >
      <View style={isTall ? styles.bodyTall : styles.bodyFeed}>
        {isTall ? <YearCoverTall model={model} /> : <YearCoverFeed model={model} />}

        {model.rows.length > 0 ? (
          <View style={styles.tripSection}>
            <Text style={styles.sectionHeading}>旅程 · {model.tripCount} 趟</Text>
            <View style={styles.tripGroup}>
              {model.rows.map((row, index) => (
                <View
                  key={`${row.title}-${row.dates}-${index}`}
                  style={[
                    styles.tripRow,
                    isTall ? styles.tripRowTall : styles.tripRowFeed,
                    index > 0 && styles.tripRowDivider,
                  ]}
                >
                  <Text style={styles.rowFlag}>{row.flag}</Text>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {row.title}
                  </Text>
                  <Text style={styles.rowRoute} numberOfLines={1}>
                    {row.route}
                  </Text>
                  <Text style={styles.rowDates} numberOfLines={1}>
                    {row.dates}
                  </Text>
                </View>
              ))}
              {model.overflowTrips > 0 ? (
                <View
                  style={[
                    styles.moreTripsRow,
                    isTall ? styles.tripRowTall : styles.tripRowFeed,
                    styles.tripRowDivider,
                  ]}
                >
                  <Text style={styles.overflowText}>還有 {model.overflowTrips} 趟旅程</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>

      <CardFooter />
    </View>
  );
}

function YearCoverTall({ model }: { model: YearShareModel }) {
  const styles = useStyles(make);

  return (
    <View style={styles.coverTall}>
      <View style={styles.coverTopRow}>
        <Text style={styles.coverHeadingTall}>飛行護照</Text>
        <View style={styles.periodPill}>
          <Text style={styles.periodText}>{model.periodLabel}</Text>
        </View>
      </View>

      {model.flags.length > 0 ? (
        <View style={styles.flagStrip}>
          {model.flags.map((flag, idx) => (
            <Text key={idx} style={styles.flagTall}>
              {flag}
            </Text>
          ))}
          {model.moreFlags > 0 ? <Text style={styles.moreFlags}>+{model.moreFlags}</Text> : null}
        </View>
      ) : null}

      <ArcDiagram flights={model.flights} width={284} height={132} inset />

      <View style={styles.statsBarTall}>
        <View style={styles.statColTall}>
          <Text style={styles.statValTall} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {model.totalFlights}
          </Text>
          <Text style={styles.statLabel}>航班</Text>
        </View>
        <View style={styles.statColTall}>
          <Text style={styles.statValTall} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {model.totalHours}
          </Text>
          <Text style={styles.statLabel}>小時</Text>
        </View>
        <View style={styles.statColTall}>
          <Text style={styles.statValTall} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {model.totalKmLabel}
          </Text>
          <Text style={styles.statLabel}>飛行距離</Text>
        </View>
      </View>
    </View>
  );
}

function YearCoverFeed({ model }: { model: YearShareModel }) {
  const styles = useStyles(make);

  return (
    <View style={styles.coverFeed}>
      <View style={styles.coverTopRow}>
        <Text style={styles.coverHeadingFeed}>飛行護照</Text>
        {model.flags.length > 0 ? (
          <View style={styles.flagStripInline}>
            {model.flags.map((flag, idx) => (
              <Text key={idx} style={styles.flagFeed}>
                {flag}
              </Text>
            ))}
            {model.moreFlags > 0 ? <Text style={styles.moreFlags}>+{model.moreFlags}</Text> : null}
          </View>
        ) : null}
        <View style={[styles.periodPill, styles.periodPillEnd]}>
          <Text style={styles.periodText}>{model.periodLabel}</Text>
        </View>
      </View>

      <View style={styles.coverFeedBody}>
        <View style={styles.feedGrid}>
          <View style={styles.feedGridRow}>
            <View style={styles.feedStatCell}>
              <Text style={styles.feedBigVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {model.totalFlights}
              </Text>
              <Text style={styles.statLabel}>航班</Text>
            </View>
            <View style={styles.feedStatCell}>
              <Text style={styles.feedBigVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {model.totalHours}
              </Text>
              <Text style={styles.statLabel}>小時</Text>
            </View>
          </View>

          <View style={styles.feedDivider} />

          <View style={styles.feedGridRow}>
            <View style={styles.feedStatCellWide}>
              <Text style={styles.feedSubVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {model.totalKmLabel}
              </Text>
              <Text style={styles.statLabel}>飛行距離</Text>
            </View>
          </View>
        </View>

        <ArcDiagram flights={model.flights} width={128} height={130} inset />
      </View>
    </View>
  );
}

function ShareTicket({ ticket, compact }: { ticket: ShareTicketItem; compact: boolean }) {
  const styles = useStyles(make);
  const t = useTheme();
  const height = compact ? 64 : 106;
  const stub = compact ? 82 : 96;
  const notch = compact ? 16 : 20;

  return (
    <View
      style={[
        styles.ticket,
        compact ? styles.ticketCompact : styles.ticketFull,
        { height },
      ]}
    >
      {compact ? (
        <View style={styles.ticketMainCompact}>
          <Text
            style={styles.ticketRouteCompact}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
          >
            {ticket.from} → {ticket.to}
          </Text>
          <Text style={styles.ticketMetaCompact} numberOfLines={1}>
            {ticket.when}
          </Text>
        </View>
      ) : (
        <View style={styles.ticketMainFull}>
          <Text style={styles.ticketMetaFull} numberOfLines={1}>
            {ticket.heading}
          </Text>
          <Text
            style={styles.ticketRouteFull}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
          >
            {ticket.from} → {ticket.to}
          </Text>
          <Text style={styles.ticketMetaFull} numberOfLines={1}>
            {ticket.when}
          </Text>
        </View>
      )}

      <View style={[styles.ticketStub, { width: stub }]}>
        <Text
          style={compact ? styles.stubCodeCompact : styles.stubCodeFull}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.65}
        >
          {ticket.stubValue}
        </Text>
      </View>

      <Svg width={2} height={height} style={[styles.tear, { right: stub - 1 }]}>
        <Line
          x1={1}
          y1={notch / 2 + 2}
          x2={1}
          y2={height - notch / 2 - 2}
          stroke={t.muted}
          strokeOpacity={0.5}
          strokeWidth={1.6}
          strokeDasharray="4.5 5.5"
        />
      </Svg>
      <View
        style={[
          styles.notch,
          {
            width: notch,
            height: notch,
            borderRadius: notch / 2,
            top: -notch / 2,
            right: stub - notch / 2,
          },
        ]}
      />
      <View
        style={[
          styles.notch,
          {
            width: notch,
            height: notch,
            borderRadius: notch / 2,
            bottom: -notch / 2,
            right: stub - notch / 2,
          },
        ]}
      />
    </View>
  );
}

function CardFooter() {
  const styles = useStyles(make);
  const t = useTheme();

  return (
    <View style={styles.footer}>
      <Svg width={15} height={15} viewBox="0 0 16 16" fill="none">
        <Circle cx={8} cy={8} r={6.6} stroke={t.muted} strokeOpacity={0.75} strokeWidth={1.3} />
        <Line x1={1.5} y1={8} x2={14.5} y2={8} stroke={t.muted} strokeOpacity={0.75} strokeWidth={1.1} />
        <Ellipse cx={8} cy={8} rx={3.3} ry={6.6} stroke={t.muted} strokeOpacity={0.75} strokeWidth={1.1} />
      </Svg>
      <Text style={styles.footerText}>WorldTrace</Text>
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.ground,
      paddingHorizontal: 20,
      justifyContent: 'space-between',
    },
    cardTall: { paddingTop: 26, paddingBottom: 18 },
    cardFeed: { paddingTop: 18, paddingBottom: 13 },

    bodyTall: { gap: 11 },
    bodyFeed: { gap: 8 },

    tripHeadBlock: { gap: 3 },
    tripTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tripFlagTall: { fontSize: 27 },
    tripFlagFeed: { fontSize: 23 },
    tripTitle: { flex: 1, color: t.ink, fontWeight: '900' },
    tripTitleTall: { fontSize: 27 },
    tripTitleFeed: { fontSize: 23 },
    badge: {
      height: 28,
      paddingHorizontal: 11,
      borderRadius: radius.round,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: t.ink, fontFamily: FONT.bold, fontSize: 11.5 },
    tripDates: { color: t.muted, fontFamily: FONT.bold, fontSize: 13, paddingLeft: 2 },

    routeBoxTall: {
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderRadius: 20,
      backgroundColor: t.soft,
    },
    routeBoxFeed: {
      paddingVertical: 9,
      paddingHorizontal: 10,
      borderRadius: 18,
      backgroundColor: t.soft,
    },

    ticketStackTall: { gap: 9 },
    ticketStackFeed: { gap: 7 },
    overflowPill: {
      height: 28,
      borderRadius: 14,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    overflowText: { color: t.muted, fontSize: 11.5, fontWeight: '700' },

    ticket: {
      backgroundColor: t.soft,
      flexDirection: 'row',
      overflow: 'hidden',
    },
    ticketFull: { borderRadius: 24 },
    ticketCompact: { borderRadius: 19 },
    ticketMainFull: {
      flex: 1,
      paddingVertical: 13,
      paddingHorizontal: 18,
      justifyContent: 'space-between',
    },
    ticketMainCompact: {
      flex: 1,
      paddingVertical: 9,
      paddingHorizontal: 16,
      justifyContent: 'center',
      gap: 2,
    },
    ticketMetaFull: { color: t.muted, fontSize: 12.5 },
    ticketMetaCompact: { color: t.muted, fontSize: 11.5 },
    ticketRouteFull: { color: t.ink, fontFamily: FONT.extraBold, fontSize: 26, letterSpacing: -0.5 },
    ticketRouteCompact: {
      color: t.ink,
      fontFamily: FONT.extraBold,
      fontSize: 19.5,
      letterSpacing: -0.3,
    },
    ticketStub: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
    stubCodeFull: { color: t.ink, fontFamily: FONT.extraBold, fontSize: 19, letterSpacing: -0.3 },
    stubCodeCompact: { color: t.ink, fontFamily: FONT.extraBold, fontSize: 16, letterSpacing: -0.2 },
    tear: { position: 'absolute', top: 0 },
    notch: { position: 'absolute', backgroundColor: t.ground },

    coverTall: {
      paddingHorizontal: 18,
      paddingVertical: 16,
      borderRadius: radius.ticket,
      backgroundColor: t.tile,
      gap: 10,
    },
    coverFeed: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 24,
      backgroundColor: t.tile,
      gap: 10,
    },
    coverTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    coverHeadingTall: { flex: 1, color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
    coverHeadingFeed: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
    periodPill: {
      height: 25,
      paddingHorizontal: 11,
      borderRadius: radius.round,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    periodPillEnd: { marginLeft: 'auto' },
    periodText: { color: t.ink, fontFamily: FONT.extraBold, fontSize: 12 },

    flagStrip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    flagStripInline: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
    flagTall: { fontSize: 21 },
    flagFeed: { fontSize: 15.5 },
    moreFlags: { color: t.onTile, fontFamily: FONT.bold, fontSize: 12 },

    // The three figures as one group in the middle, each over its label.
    statsBarTall: {
      flexDirection: 'row',
      justifyContent: 'center',
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: t.accent,
      gap: 28,
    },
    statColTall: { alignItems: 'center', minWidth: 0 },
    statValTall: { color: '#FFFFFF', fontFamily: FONT.extraBold, fontSize: 16, letterSpacing: -0.3 },
    statLabel: { color: t.onTile, fontSize: 11 },

    coverFeedBody: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    feedGrid: { flex: 1, gap: 8 },
    feedGridRow: { flexDirection: 'row', gap: 8 },
    feedStatCell: { flex: 1, minWidth: 0 },
    feedStatCellWide: { flex: 1.35, minWidth: 0 },
    feedBigVal: { color: '#FFFFFF', fontFamily: FONT.extraBold, fontSize: 21, letterSpacing: -0.4 },
    feedSubVal: { color: '#FFFFFF', fontFamily: FONT.extraBold, fontSize: 14.5, letterSpacing: -0.3 },
    feedDivider: { height: 1, backgroundColor: t.accent, opacity: 0.45 },

    tripSection: { gap: 5 },
    sectionHeading: { color: t.muted, fontFamily: FONT.bold, fontSize: 12, paddingHorizontal: 4 },
    tripGroup: {
      borderRadius: 20,
      backgroundColor: t.soft,
      overflow: 'hidden',
    },
    tripRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 13,
      gap: 6,
    },
    tripRowTall: { height: 38 },
    tripRowFeed: { height: 35 },
    tripRowDivider: { borderTopWidth: 1, borderTopColor: t.ground },
    rowFlag: { fontSize: 14.5 },
    rowTitle: { color: t.ink, fontSize: 13, fontWeight: '700', maxWidth: 66 },
    rowRoute: { flex: 1, color: t.muted, fontFamily: FONT.bold, fontSize: 10, paddingLeft: 2 },
    rowDates: { color: t.muted, fontFamily: FONT.bold, fontSize: 10.5 },
    moreTripsRow: { alignItems: 'center', justifyContent: 'center' },

    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    footerText: { color: t.muted, fontFamily: FONT.bold, fontSize: 11.5, opacity: 0.85 },
  });
