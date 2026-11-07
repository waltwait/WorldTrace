import { memo, useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
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
import { attachFlightDoc, deleteFlightAndDocs, removeFlightDoc } from '../store/flightDocs';
import { saveSyncedFlight } from '../store/flightRefresh';
import { listFlightDocs, updateFlight } from '../store/flights';
import { ActionButton } from './ActionButton';
import { ask } from './dialog';
import { formatFlightDistance } from './format';
import { Icon } from './Icon';
import { PressScale } from './PressScale';
import { Ticket } from './Ticket';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, radius, SHARED, type Theme } from './themes';
import { Text, TextInput } from './Text';

interface FlightDetailSheetProps {
  flight: FlightRecord | null;
  visible: boolean;
  onClose: () => void;
  onFlightUpdated: (flight: FlightRecord) => void;
  onFlightDeleted: (flightId: string) => void;
  onViewOnMap?: (flight: FlightRecord) => void;
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

/**
 * ActionButton swallows a thrown error, so each action here catches its own
 * and says so in the app's dialog: a failure is reported by a dialog, never
 * by the button (CLAUDE.md).
 */
async function failed(title: string, error: unknown): Promise<{ ok: false }> {
  await ask({
    title,
    message: error instanceof Error ? error.message : String(error),
    confirmLabel: '好',
  });
  return { ok: false };
}

function FlightDetailContent({
  flight,
  visible,
  onClose,
  onFlightUpdated,
  onFlightDeleted,
  onViewOnMap,
}: FlightDetailSheetProps & { flight: FlightRecord }) {
  const styles = useStyles(make);
  const t = useTheme();
  const [docs, setDocs] = useState<FlightDocRecord[]>([]);
  const [editingGate, setEditingGate] = useState(false);
  const [depGateInput, setDepGateInput] = useState('');
  const [arrGateInput, setArrGateInput] = useState('');
  const [baggageInput, setBaggageInput] = useState('');

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

    setEditingGate(false);

    return () => {
      cancelled = true;
    };
  }, [flight.id, visible]);

  // On the values as well as the id: a sync changes them under an open sheet,
  // and saving the old text in these boxes would wipe what it found.
  useEffect(() => {
    setDepGateInput(flight.depGate ?? '');
    setArrGateInput(flight.arrGate ?? '');
    setBaggageInput(flight.baggageBelt ?? '');
  }, [flight.id, flight.depGate, flight.arrGate, flight.baggageBelt]);

  // The offsets on the day of the flight, not today: across a daylight-saving
  // change the difference is an hour out otherwise.
  const timeDifference = arrivalTimeDifference(flight.depTz, flight.arrTz, flight.depScheduledUtc);

  const toggleFinished = useCallback(async () => {
    try {
      const nextFinished = !flight.isFinished;
      const db = await database();
      await updateFlight(db, flight.id, { isFinished: nextFinished });
      const updated = { ...flight, isFinished: nextFinished };
      onFlightUpdated(updated);
      return {
        ok: true as const,
        message: nextFinished ? '已標記為完成' : '已移至即將出發',
      };
    } catch (error) {
      return failed('無法更新航班', error);
    }
  }, [flight, onFlightUpdated]);

  const handleSyncStatus = useCallback(async () => {
    try {
      const port = createAeroDataBoxPort((await apiKey('flightStatus')) ?? undefined);
      const updated = await syncFlightStatus(flight, port, Date.now());
      if (updated === flight) {
        return { ok: true as const, message: '目前查不到最新動態' };
      }
      const db = await database();
      await saveSyncedFlight(db, flight, updated);
      onFlightUpdated(updated);
      return {
        ok: true as const,
        message: `航班狀態：${statusLabel(updated)}${updated.depGate ? ` · 登機門 ${updated.depGate}` : ''}`,
      };
    } catch (error) {
      return failed('同步失敗', error);
    }
  }, [flight, onFlightUpdated]);

  const handleSaveGates = useCallback(async () => {
    const patch = {
      depGate: depGateInput.trim() || null,
      arrGate: arrGateInput.trim() || null,
      baggageBelt: baggageInput.trim() || null,
    };
    try {
      const db = await database();
      await updateFlight(db, flight.id, patch);
      const updated: FlightRecord = {
        ...flight,
        depGate: patch.depGate,
        arrGate: patch.arrGate,
        baggageBelt: patch.baggageBelt,
      };
      onFlightUpdated(updated);
      setEditingGate(false);
      return { ok: true as const, message: '已更新登機門與行李轉盤' };
    } catch (error) {
      return failed('無法儲存登機門', error);
    }
  }, [flight, depGateInput, arrGateInput, baggageInput, onFlightUpdated]);

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

  const handleDelete = useCallback(async () => {
    const confirmed = await ask({
      title: '刪除航班',
      message: `確定要刪除 ${flight.flightNumber} 嗎？此操作無法復原。`,
      confirmLabel: '刪除',
      cancelLabel: '取消',
      destructive: true,
    });

    if (!confirmed) return;

    try {
      const db = await database();
      await deleteFlightAndDocs(db, expoDocFiles, flight.id);
      onFlightDeleted(flight.id);
      onClose();
    } catch (error) {
      await failed('無法刪除航班', error);
    }
  }, [flight, onFlightDeleted, onClose]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <PressScale style={styles.back} onPress={onClose} label="返回" hitSlop={8}>
          <Icon name="back" color={t.ink} />
        </PressScale>

        <Ticket
          ticket={ticketFor(flight, Date.now())}
          heading={`${flight.flightNumber} ${flight.airlineName}`}
        />

        <View style={styles.times}>
          <View>
            <Text style={styles.time}>{airportTime(flight.depScheduledUtc, flight.depTz)}</Text>
            <Text style={styles.place}>{placeLine(flight.depCity, flight.depIata, flight.depTerminal)}</Text>
          </View>
          <View style={styles.alignEnd}>
            <Text style={styles.time}>{airportTime(flight.arrScheduledUtc, flight.arrTz)}</Text>
            <Text style={styles.place}>{placeLine(flight.arrCity, flight.arrIata, flight.arrTerminal)}</Text>
          </View>
        </View>

        <View style={styles.group}>
          <Fact label="狀態" value={statusLabel(flight)} first />
          <Fact label="飛行時間" value={durationText(flight.durationMinutes)} />
          <Fact label="距離" value={formatFlightDistance(flight.distanceKm)} />
          {timeDifference.hasDifference ? <Fact label="時差" value={timeDifference.headline} /> : null}
          {flight.scheduleSource === 'nearby' ? <Fact label="班表" value="取自近期班次" /> : null}
          {flight.seat ? <Fact label="座位" value={flight.seat} /> : null}
          {flight.notes ? <Fact label="備註" value={flight.notes} /> : null}
        </View>

        <View style={styles.group}>
          <PressScale onPress={() => setEditingGate((v) => !v)}>
            <Fact label="起飛登機門" value={flight.depGate ?? '—'} first />
            <Fact label="抵達登機門" value={flight.arrGate ?? '—'} />
            <Fact label="行李轉盤" value={flight.baggageBelt ?? '—'} />
          </PressScale>

          {editingGate ? (
            <View style={styles.editor}>
              <View style={styles.inputs}>
                <GateInput label="起飛" value={depGateInput} onChange={setDepGateInput} caps />
                <GateInput label="抵達" value={arrGateInput} onChange={setArrGateInput} caps />
                <GateInput label="轉盤" value={baggageInput} onChange={setBaggageInput} />
              </View>
              <ActionButton
                variant="primary"
                label="儲存修改"
                busyLabel="儲存中…"
                onPress={handleSaveGates}
              />
            </View>
          ) : null}
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

        <View style={styles.actions}>
          <PressScale
            containerStyle={styles.action}
            style={styles.mapButton}
            onPress={() => {
              onClose();
              onViewOnMap?.(flight);
            }}
          >
            <Text style={styles.mapButtonText}>在地圖上看</Text>
          </PressScale>
          <ActionButton
            variant="secondary"
            label="更新動態"
            busyLabel="查詢中…"
            onPress={handleSyncStatus}
          />
        </View>

        <View style={styles.quiet}>
          <PressScale onPress={() => void toggleFinished()} hitSlop={8}>
            <Text style={styles.quietText}>
              {flight.isFinished ? '移回即將出發' : '標記為已完成'}
            </Text>
          </PressScale>
          <PressScale onPress={() => void handleDelete()} hitSlop={8}>
            <Text style={styles.deleteText}>刪除航班</Text>
          </PressScale>
        </View>
      </ScrollView>
    </Modal>
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
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function GateInput({
  label,
  value,
  onChange,
  caps = false,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  caps?: boolean;
}) {
  const styles = useStyles(make);
  return (
    <View style={styles.input}>
      <Text style={styles.factLabel}>{label}</Text>
      <TextInput
        style={styles.inputField}
        value={value}
        onChangeText={onChange}
        autoCapitalize={caps ? 'characters' : 'none'}
      />
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { paddingHorizontal: 16, paddingTop: 48, paddingBottom: 32, gap: 12 },
    back: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
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
    editor: { padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: t.ground },
    inputs: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, gap: 4 },
    inputField: {
      height: 44,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: t.ground,
      color: t.ink,
      fontSize: 16,
      fontWeight: '700',
    },
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
    actions: { flexDirection: 'row', gap: 10 },
    action: { flexGrow: 1, flexBasis: 0 },
    mapButton: {
      height: 52,
      borderRadius: radius.round,
      backgroundColor: t.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mapButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    quiet: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    quietText: { color: t.ink, fontSize: 14 },
    deleteText: { color: SHARED.danger, fontSize: 14 },
  });
