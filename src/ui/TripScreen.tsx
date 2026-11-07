/**
 * One trip, opened from its block on the passport: its route, its tickets, and the
 * links kept for it. A link is opened in whatever the phone opens it with; the
 * app never fetches it. New links are kept on the trip's first flight (trips.ts).
 */

import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { ticketFor } from '../flights/flightDisplay';
import { linkHost, linkLabel, readLink } from '../flights/tripLinks';
import { routeChain, tripDates, type PassportTrip } from '../flights/trips';
import type { FlightLinkRecord, FlightRecord } from '../flights/types';
import { ActionButton } from './ActionButton';
import { ask } from './dialog';
import { FullScreenModal } from './FullScreenModal';
import { Icon } from './Icon';
import { PressScale } from './PressScale';
import { RouteLine } from './RouteLine';
import { ShareCardSheet } from './ShareCardSheet';
import { SheetHeader } from './SheetHeader';
import { Text, TextInput } from './Text';
import { Ticket } from './Ticket';
import { useStyles, useTheme } from './ThemeProvider';
import { radius, type Theme } from './themes';

async function failed(title: string, error: unknown): Promise<void> {
  await ask({
    title,
    message: error instanceof Error ? error.message : String(error),
    confirmLabel: '好',
  });
}

export function TripScreen({
  trip,
  links,
  visible,
  onClose,
  onOpenFlight,
  onAddLink,
  onRemoveLink,
}: {
  trip: PassportTrip;
  links: FlightLinkRecord[];
  visible: boolean;
  onClose: () => void;
  onOpenFlight: (flight: FlightRecord) => void;
  onAddLink: (link: FlightLinkRecord) => Promise<void>;
  onRemoveLink: (id: string) => Promise<void>;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');

  // Each time it opens it starts closed, so a half-typed link does not wait there.
  useEffect(() => {
    if (!visible) {
      setSharing(false);
      return;
    }
    setAdding(false);
    setUrl('');
    setName('');
  }, [visible]);

  const addLink = useCallback(async () => {
    const read = readLink(url, name);
    if (!read.ok) {
      await ask({ title: read.error, confirmLabel: '好' });
      return { ok: false as const };
    }

    try {
      const now = Date.now();
      await onAddLink({
        id: `link_${now}_${Math.random().toString(36).slice(2, 6)}`,
        flightId: trip.flights[0].id,
        url: read.url,
        title: read.title,
        createdAt: now,
      });
      setUrl('');
      setName('');
      setAdding(false);
      return { ok: true as const, message: '已加入' };
    } catch (error) {
      await failed('無法加入連結', error);
      return { ok: false as const };
    }
  }, [name, onAddLink, trip, url]);

  const openLink = useCallback(async (link: FlightLinkRecord) => {
    try {
      await Linking.openURL(link.url);
    } catch (error) {
      await failed('無法開啟連結', error);
    }
  }, []);

  const removeLink = useCallback(
    async (link: FlightLinkRecord) => {
      const confirmed = await ask({
        title: '刪除連結',
        message: `確定要刪除「${linkLabel(link)}」嗎？`,
        confirmLabel: '刪除',
        cancelLabel: '取消',
        destructive: true,
      });
      if (!confirmed) return;

      try {
        await onRemoveLink(link.id);
      } catch (error) {
        await failed('無法刪除連結', error);
      }
    },
    [onRemoveLink],
  );

  const now = Date.now();

  return (
    <>
      <FullScreenModal visible={visible} onRequestClose={onClose}>
        <View style={styles.screen}>
          <SheetHeader
            title={trip.title}
            note={tripDates(trip, null)}
            onBack={onClose}
            action={{ icon: 'share', label: '匯出圖片', onPress: () => setSharing(true) }}
          />
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.route}>
            <RouteLine steps={routeChain(trip.flights)} large />
          </View>

          {trip.flights.map((flight) => (
            <Ticket
              key={flight.id}
              ticket={ticketFor(flight, now)}
              heading={`${flight.flightNumber} ${flight.airlineName}`}
              onPress={() => onOpenFlight(flight)}
            />
          ))}

          <Text style={styles.heading}>行程連結</Text>
          <View style={styles.group}>
            {links.map((link, index) => (
              <PressScale
                key={link.id}
                style={[styles.row, index > 0 && styles.line]}
                onPress={() => void openLink(link)}
                onLongPress={() => void removeLink(link)}
              >
                <Icon name="link" color={t.ink} size={18} />
                <View style={styles.linkText}>
                  <Text style={styles.linkName} numberOfLines={1}>
                    {linkLabel(link)}
                  </Text>
                  {link.title ? (
                    <Text style={styles.linkHost} numberOfLines={1}>
                      {linkHost(link.url)}
                    </Text>
                  ) : null}
                </View>
                <Icon name="chevronRight" color={t.muted} size={18} />
              </PressScale>
            ))}

            <PressScale
              style={[styles.row, styles.addRow, links.length > 0 && styles.line]}
              onPress={() => setAdding((open) => !open)}
            >
              <Text style={styles.linkName}>新增連結</Text>
              <Icon name="plus" color={t.muted} size={18} />
            </PressScale>

            {adding ? (
              <View style={[styles.editor, styles.line]}>
                <TextInput
                  style={styles.input}
                  value={url}
                  onChangeText={setUrl}
                  placeholder="網址"
                  placeholderTextColor={t.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  autoFocus
                />
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="名稱"
                  placeholderTextColor={t.muted}
                  maxLength={40}
                />
                <ActionButton variant="primary" label="加入" busyLabel="加入中…" onPress={addLink} />
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </FullScreenModal>

    <ShareCardSheet
      target={{ kind: 'trip', trip }}
      visible={visible && sharing}
      onClose={() => setSharing(false)}
    />
    </>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32, gap: 12 },
    route: { paddingTop: 16, paddingBottom: 12, paddingHorizontal: 12, borderRadius: radius.group, backgroundColor: t.soft },
    heading: { color: t.muted, fontSize: 14, paddingHorizontal: 8, marginTop: 6 },
    group: { borderRadius: radius.group, backgroundColor: t.soft, overflow: 'hidden' },
    line: { borderTopWidth: 1, borderTopColor: t.ground },
    row: { minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
    addRow: { minHeight: 52, justifyContent: 'space-between' },
    linkText: { flex: 1, minWidth: 0, gap: 2 },
    linkName: { color: t.ink, fontSize: 15 },
    linkHost: { color: t.muted, fontSize: 12 },
    editor: { padding: 12, gap: 10 },
    input: {
      height: 48,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: t.ground,
      color: t.ink,
      fontSize: 16,
    },
  });
