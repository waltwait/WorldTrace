import { memo, useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { expoTicketReader } from '../flights/expoTicketReader';
import { pickTicketImage } from '../flights/expoPickTicketImage';
import { readTicket } from '../flights/readTicket';
import { boardingPassOpen } from '../flights/reminders';
import { seatFromTicket } from '../flights/seatFromTicket';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { airportTime, statusLabel, ticketFor } from '../flights/flightDisplay';
import {
  createAeroDataBoxPort,
  syncFlightStatus,
} from '../flights/flightStatusApi';
import type { FlightDocRecord, FlightRecord } from '../flights/types';
import { arrivalTimeDifference } from '../flights/zonedTime';
import { apiKey } from '../settings/expoKeyStore';
import { database } from '../store/database';
import { expoDocFiles } from '../store/expoDocFiles';
import { attachFlightDoc, removeFlightDoc } from '../store/flightDocs';
import { saveSyncedFlight } from '../store/flightRefresh';
import { listFlightDocs, updateFlight } from '../store/flights';
import { ActionButton } from './ActionButton';
import { ask } from './dialog';
import { formatFlightDistance } from './format';
import { FullScreenModal } from './FullScreenModal';
import { Icon } from './Icon';
import { PressScale } from './PressScale';
import { SwapText } from './SwapText';
import { Ticket } from './Ticket';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, radius, type Theme } from './themes';
import { Text, TextInput } from './Text';
import { SheetHeader } from './SheetHeader';

interface FlightDetailSheetProps {
  flight: FlightRecord | null;
  visible: boolean;
  onClose: () => void;
  onFlightUpdated: (flight: FlightRecord) => void;
  onViewOnMap?: (flight: FlightRecord) => void;
  /** Opened from the reminder: start by reading the boarding pass, once the page is up. */
  readPassOnOpen?: boolean;
  /** The pass has been asked for, or there was no point asking. */
  onPassStarted?: () => void;
}

// The sheet is mounted before any flight is chosen. Every hook lives in
// FlightDetailContent, which only exists once there is a flight: returning
// null for a missing flight ahead of the hooks changed how many hooks ran
// between renders, and React took the whole app down on the first tapped card.
export const FlightDetailSheet = memo(function FlightDetailSheet(
  props: FlightDetailSheetProps,
) {
  const { flight } = props;
  if (!flight) return null;
  return <FlightDetailContent {...props} flight={flight} />;
});

/** Reports a failed detail action in the app's dialog (CLAUDE.md). */
async function failed(title: string, error: unknown): Promise<void> {
  await ask({
    title,
    message: error instanceof Error ? error.message : String(error),
    confirmLabel: '好',
  });
}

function FlightDetailContent({
  flight,
  visible,
  onClose,
  onFlightUpdated,
  onViewOnMap,
  readPassOnOpen = false,
  onPassStarted,
}: FlightDetailSheetProps & { flight: FlightRecord }) {
  const styles = useStyles(make);
  const t = useTheme();
  // The picker waits for the slide: launched during it, the page arrived under it.
  const [entered, setEntered] = useState(false);
  const passOpen = boardingPassOpen(flight, Date.now());
  const [docs, setDocs] = useState<FlightDocRecord[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [editingSeat, setEditingSeat] = useState(false);
  const [seatInput, setSeatInput] = useState(flight.seat ?? '');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await database();
        const list = await listFlightDocs(db, flight.id);
        if (!cancelled) setDocs(list);
      } catch {
        // Ignore read errors
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [flight.id, visible]);

  // The offsets on the day of the flight, not today: across a daylight-saving
  // change the difference is an hour out otherwise.
  const timeDifference = arrivalTimeDifference(flight.depTz, flight.arrTz, flight.depScheduledUtc);

  // Pulled down by hand, so this asks whatever the polling schedule says. A status
  // that changes shows on the page; only an empty answer needs saying.
  const pullToSync = useCallback(async () => {
    setSyncing(true);
    let nothing = false;
    try {
      const port = createAeroDataBoxPort((await apiKey('flightStatus')) ?? undefined);
      const updated = await syncFlightStatus(flight, port, Date.now());
      if (updated === flight) {
        nothing = true;
      } else {
        await saveSyncedFlight(await database(), flight, updated);
        onFlightUpdated(updated);
      }
    } catch (error) {
      setSyncing(false);
      await failed('同步失敗', error);
      return;
    }
    setSyncing(false);
    if (nothing) await ask({ title: '目前查不到最新動態', confirmLabel: '好' });
  }, [flight, onFlightUpdated]);

  const saveSeat = useCallback(
    async (seat: string | null) => {
      await updateFlight(await database(), flight.id, { seat });
      onFlightUpdated({ ...flight, seat });
    },
    [flight, onFlightUpdated],
  );

  // On the day: the boarding pass gives the seat, if it is this flight's. The picture
  // is deleted once read, as when a flight is added.
  const seatFromPass = useCallback(async () => {
    try {
      const uri = await pickTicketImage();
      if (!uri) return { ok: false as const };
      const result = seatFromTicket(flight, await readTicket(expoTicketReader, uri, Date.now()));
      if (!result.ok) {
        await ask({ title: '無法更新座位', message: result.message, confirmLabel: '好' });
        return { ok: false as const };
      }
      await saveSeat(result.seat);
      setSeatInput(result.seat);
      return { ok: true as const, message: `座位 ${result.seat}` };
    } catch (error) {
      await failed('無法更新座位', error);
      return { ok: false as const };
    }
  }, [flight, saveSeat]);

  const seatByHand = useCallback(async () => {
    try {
      await saveSeat(seatInput.trim().toUpperCase() || null);
      setEditingSeat(false);
      return { ok: true as const, message: '已儲存' };
    } catch (error) {
      await failed('無法更新座位', error);
      return { ok: false as const };
    }
  }, [saveSeat, seatInput]);

  useEffect(() => {
    if (!visible) setEntered(false);
  }, [visible]);

  // Tapped from the reminder: the photo is asked for at once. Tapped after it landed,
  // there is no pass to read, and the page just opens.
  useEffect(() => {
    if (!readPassOnOpen || !entered) return;
    onPassStarted?.();
    if (boardingPassOpen(flight, Date.now())) void seatFromPass();
  }, [entered, flight, onPassStarted, readPassOnOpen, seatFromPass]);

  const handleAddDoc = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const db = await database();
      const newDoc = await attachFlightDoc(db, expoDocFiles, {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        flightId: flight.id,
        sourceUri: asset.uri,
        fileName: asset.name,
        mimeType: asset.mimeType ?? 'application/pdf',
        now: Date.now(),
      });
      setDocs((prev) => [...prev, newDoc]);
    } catch (error) {
      // A cancelled pick returns above; anything here is a real failure, such
      // as the copy into the app's documents, and is said out loud.
      await ask({
        title: '無法附加檔案',
        message: error instanceof Error ? error.message : String(error),
        confirmLabel: '好',
      });
    }
  }, [flight.id]);

  const handleOpenDoc = useCallback(async (doc: FlightDocRecord) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('這台裝置無法開啟檔案');
      }
      await Sharing.shareAsync(doc.localUri, {
        mimeType: doc.mimeType,
        dialogTitle: doc.fileName,
      });
    } catch (error) {
      // Restored from a backup, the row is here and the file is not.
      await failed('無法開啟檔案', error);
    }
  }, []);

  const handleDeleteDoc = useCallback(
    async (doc: FlightDocRecord) => {
      const confirmed = await ask({
        title: '刪除機票檔案',
        message: `確定要刪除「${doc.fileName}」嗎？`,
        confirmLabel: '刪除',
        cancelLabel: '取消',
        destructive: true,
      });

      if (!confirmed) return;

      try {
        const db = await database();
        await removeFlightDoc(db, expoDocFiles, doc);
        setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      } catch (error) {
        await failed('無法刪除檔案', error);
      }
    },
    [],
  );

  return (
    <FullScreenModal visible={visible} onRequestClose={onClose} onEntered={() => setEntered(true)}>
      <View style={styles.screen}>
      <SheetHeader onBack={onClose} />
      <ScrollView
        contentContainerStyle={styles.content}
        // Nothing new can come of a flight that is over, and asking costs.
        refreshControl={
          flight.isFinished || flight.status === 'CANCELLED' ? undefined : (
            <RefreshControl refreshing={syncing} onRefresh={pullToSync} tintColor={t.muted} />
          )
        }
      >
        <Ticket
          ticket={ticketFor(flight, Date.now())}
          heading={`${flight.flightNumber} ${flight.airlineName}`}
        />

        <View style={styles.times}>
          <View>
            <SwapText text={airportTime(flight.depScheduledUtc, flight.depTz)} style={styles.time} />
            <SwapText
              text={placeLine(flight.depCity, flight.depIata, flight.depTerminal)}
              style={styles.place}
            />
          </View>
          <View style={styles.alignEnd}>
            <SwapText text={airportTime(flight.arrScheduledUtc, flight.arrTz)} style={styles.time} />
            <SwapText
              text={placeLine(flight.arrCity, flight.arrIata, flight.arrTerminal)}
              style={styles.place}
            />
          </View>
        </View>

        <View style={styles.group}>
          <Fact label="狀態" value={statusLabel(flight)} first />
          <Fact label="飛行時間" value={durationText(flight.durationMinutes)} />
          <Fact label="距離" value={formatFlightDistance(flight.distanceKm)} />
          {timeDifference.hasDifference ? <Fact label="時差" value={timeDifference.headline} /> : null}
          {flight.scheduleSource === 'nearby' ? <Fact label="班表" value="取自鄰近班次" /> : null}
          {flight.notes ? <Fact label="備註" value={flight.notes} /> : null}
        </View>

        <View style={styles.group}>
          {/* From an hour before it leaves until it lands: the pass is in the hand then. */}
          {passOpen ? (
            <ActionButton
              variant="row"
              label="用登機證更新座位"
              busyLabel="辨識中…"
              onPress={seatFromPass}
            />
          ) : null}
          <PressScale
            style={[styles.docRow, passOpen && styles.line]}
            onPress={() => setEditingSeat((v) => !v)}
          >
            <Text style={styles.docText}>座位</Text>
            <Text style={styles.seatValue}>{flight.seat ?? '—'}</Text>
          </PressScale>
          {editingSeat ? (
            <View style={[styles.seatEditor, styles.line]}>
              <TextInput
                style={styles.seatInput}
                value={seatInput}
                onChangeText={setSeatInput}
                placeholder="22C"
                placeholderTextColor={t.muted}
                autoCapitalize="characters"
                maxLength={4}
              />
              <ActionButton variant="primary" label="儲存" busyLabel="儲存中…" onPress={seatByHand} />
            </View>
          ) : null}
        </View>

        <View style={styles.group}>
          <Fact label="起飛登機門" value={flight.depGate ?? '—'} first />
          <Fact label="抵達登機門" value={flight.arrGate ?? '—'} />
          <Fact label="行李轉盤" value={flight.baggageBelt ?? '—'} />
        </View>

        <View style={styles.group}>
          {docs.map((doc, index) => (
            <View key={doc.id} style={[styles.docRow, index > 0 && styles.line]}>
              <PressScale containerStyle={styles.docName} onPress={() => void handleOpenDoc(doc)}>
                <Text style={styles.docText} numberOfLines={1}>
                  {doc.fileName}
                </Text>
              </PressScale>
              <PressScale onPress={() => void handleDeleteDoc(doc)} label="刪除檔案" hitSlop={8}>
                <Icon name="close" color={t.muted} size={18} />
              </PressScale>
            </View>
          ))}
          <PressScale
            style={[styles.docRow, docs.length > 0 && styles.line]}
            onPress={() => void handleAddDoc()}
          >
            <Text style={styles.docText}>附加機票</Text>
            <Icon name="plus" color={t.muted} size={18} />
          </PressScale>
        </View>

        <PressScale
          style={styles.mapButton}
          onPress={() => {
            onClose();
            onViewOnMap?.(flight);
          }}
        >
          <Text style={styles.mapButtonText}>在地圖上看</Text>
        </PressScale>
      </ScrollView>
      </View>
    </FullScreenModal>
  );
}

function placeLine(city: string | null | undefined, iata: string, terminal?: string | null): string {
  return terminal ? `${city ?? iata}，航廈 ${terminal}` : (city ?? iata);
}

function durationText(minutes: number): string {
  return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}

function Fact({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
  const styles = useStyles(make);
  return (
    <View style={[styles.fact, !first && styles.line]}>
      <Text style={styles.factLabel}>{label}</Text>
      <SwapText text={value} style={styles.factValue} />
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32, gap: 12 },
    times: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
    alignEnd: { alignItems: 'flex-end' },
    time: { color: t.ink, fontFamily: FONT.extraBold, fontSize: 30 },
    place: { color: t.muted, fontSize: 14 },
    group: { borderRadius: radius.group, backgroundColor: t.soft, overflow: 'hidden' },
    line: { borderTopWidth: 1, borderTopColor: t.ground },
    fact: {
      minHeight: 46,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    factLabel: { color: t.muted, fontSize: 15 },
    factValue: { color: t.ink, fontSize: 15, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
    docRow: {
      minHeight: 48,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    docName: { flex: 1 },
    docText: { color: t.ink, fontSize: 15 },
    seatValue: { color: t.ink, fontFamily: FONT.bold, fontSize: 15 },
    seatEditor: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
    seatInput: {
      flex: 1,
      height: 48,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: t.ground,
      color: t.ink,
      fontFamily: FONT.bold,
      fontSize: 17,
    },
    mapButton: {
      height: 52,
      borderRadius: radius.round,
      backgroundColor: t.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mapButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  });
