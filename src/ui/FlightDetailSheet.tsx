import { memo, useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { findAirport, getArrivalTimezoneSummary } from '../flights/airports';
import { airportDate, airportTime } from '../flights/flightDisplay';
import {
  createAeroDataBoxPort,
  syncFlightStatus,
} from '../flights/flightStatusApi';
import type { FlightDocRecord, FlightRecord } from '../flights/types';
import { database } from '../store/database';
import { expoDocFiles } from '../store/expoDocFiles';
import { attachFlightDoc, deleteFlightAndDocs, removeFlightDoc } from '../store/flightDocs';
import { listFlightDocs, updateFlight } from '../store/flights';
import { ActionButton } from './ActionButton';
import { PressScale } from './PressScale';
import { ask } from './dialog';
import { radius, theme } from './theme';

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
  const [docs, setDocs] = useState<FlightDocRecord[]>([]);
  const [editingGate, setEditingGate] = useState(false);
  const [depGateInput, setDepGateInput] = useState('');
  const [arrGateInput, setArrGateInput] = useState('');
  const [baggageInput, setBaggageInput] = useState('');
  const [pnrEnlarged, setPnrEnlarged] = useState(false);

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

    setDepGateInput(flight.depGate ?? '');
    setArrGateInput(flight.arrGate ?? '');
    setBaggageInput(flight.baggageBelt ?? '');
    setEditingGate(false);
    setPnrEnlarged(false);

    return () => {
      cancelled = true;
    };
  }, [flight.id]);

  const depAirport = findAirport(flight.depIata);
  const arrAirport = findAirport(flight.arrIata);
  const tzSummary = getArrivalTimezoneSummary(
    flight.depIata,
    flight.arrIata,
    // The offsets on the day of the flight, not today: across a daylight-
    // saving change the difference is an hour out otherwise.
    new Date(flight.depScheduledUtc),
  );


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
      const apiKey = process.env.EXPO_PUBLIC_FLIGHT_API_KEY;
      const port = createAeroDataBoxPort(apiKey);
      const updated = await syncFlightStatus(flight, port, Date.now());
      const db = await database();
      await updateFlight(db, flight.id, updated);
      onFlightUpdated(updated);
      return {
        ok: true as const,
        message: `航班狀態：${updated.status}${updated.depGate ? ` · Gate ${updated.depGate}` : ''}`,
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
    const isAvail = await Sharing.isAvailableAsync();
    if (isAvail) {
      await Sharing.shareAsync(doc.localUri, {
        mimeType: doc.mimeType,
        dialogTitle: doc.fileName,
      });
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

      const db = await database();
      await removeFlightDoc(db, expoDocFiles, doc);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
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

    const db = await database();
    await deleteFlightAndDocs(db, expoDocFiles, flight.id);
    onFlightDeleted(flight.id);
    onClose();
  }, [flight, onFlightDeleted, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={styles.scrimDismiss} onPress={onClose}>
          <View />
        </Pressable>

        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <View style={styles.headerRow}>
                <Text style={styles.flightNumber}>{flight.flightNumber}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    flight.isFinished && styles.statusBadgeFinished,
                  ]}
                >
                  <Text style={styles.statusBadgeText}>
                    {flight.isFinished ? 'FINISHED' : flight.status}
                  </Text>
                </View>
              </View>
              <Text style={styles.headerRoute}>
                {depAirport?.cityZh ?? flight.depIata} → {arrAirport?.cityZh ?? flight.arrIata} ·{' '}
                {airportDate(flight.depScheduledUtc, flight.depTz)}
              </Text>
            </View>
            <PressScale style={styles.closeButton} onPress={onClose} hitSlop={8}>
              <Text style={styles.closeText}>✕</Text>
            </PressScale>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {/* Route & Times Card */}
            <View style={styles.card}>
              <View style={styles.airportsRow}>
                <View style={styles.airportCol}>
                  <Text style={styles.airportFlag}>{depAirport?.flagEmoji ?? '✈️'}</Text>
                  <Text style={styles.airportIata}>{flight.depIata}</Text>
                  <Text style={styles.timeText}>{airportTime(flight.depScheduledUtc, flight.depTz)}</Text>
                  <Text style={styles.cityText}>{depAirport?.city ?? flight.depIata}</Text>

                  {/* Airport Yellow Sign Badge */}
                  <PressScale
                    style={styles.signBadge}
                    onPress={() => setEditingGate((v) => !v)}
                  >
                    <Text style={styles.signBadgeText}>
                      ↗ Gate {flight.depGate ?? '—'}
                    </Text>
                  </PressScale>
                </View>

                <View style={styles.flightMiddleCol}>
                  <Text style={styles.durationText}>
                    {Math.floor(flight.durationMinutes / 60)}h {flight.durationMinutes % 60}m
                  </Text>
                  <View style={styles.routeLine} />
                  <Text style={styles.milesText}>{flight.distanceMiles} mi</Text>
                </View>

                <View style={[styles.airportCol, styles.alignRight]}>
                  <Text style={styles.airportFlag}>{arrAirport?.flagEmoji ?? '🛬'}</Text>
                  <Text style={styles.airportIata}>{flight.arrIata}</Text>
                  <Text style={styles.timeText}>{airportTime(flight.arrScheduledUtc, flight.arrTz)}</Text>
                  <Text style={styles.cityText}>{arrAirport?.city ?? flight.arrIata}</Text>

                  {/* Airport Yellow Sign Badge */}
                  <PressScale
                    style={styles.signBadge}
                    onPress={() => setEditingGate((v) => !v)}
                  >
                    <Text style={styles.signBadgeText}>
                      ↘ Gate {flight.arrGate ?? '—'}
                    </Text>
                  </PressScale>
                </View>
              </View>

              {flight.baggageBelt ? (
                <PressScale
                  style={styles.baggageRow}
                  onPress={() => setEditingGate((v) => !v)}
                >
                  <Text style={styles.baggageIcon}>🧳</Text>
                  <Text style={styles.baggageText}>
                    行李轉盤 (Baggage Claim)：{flight.baggageBelt} 號
                  </Text>
                </PressScale>
              ) : null}

              {editingGate ? (
                <View style={styles.gateEditorBox}>
                  <Text style={styles.gateEditorTitle}>✏️ 快速更新登機門與行李轉盤</Text>
                  <View style={styles.gateEditorInputs}>
                    <View style={styles.flex1}>
                      <Text style={styles.editorLabel}>起飛 Gate</Text>
                      <TextInput
                        style={styles.gateInput}
                        value={depGateInput}
                        onChangeText={setDepGateInput}
                        placeholder="如 D6"
                        placeholderTextColor={theme.textFaint}
                        autoCapitalize="characters"
                      />
                    </View>
                    <View style={styles.flex1}>
                      <Text style={styles.editorLabel}>抵達 Gate</Text>
                      <TextInput
                        style={styles.gateInput}
                        value={arrGateInput}
                        onChangeText={setArrGateInput}
                        placeholder="如 18"
                        placeholderTextColor={theme.textFaint}
                        autoCapitalize="characters"
                      />
                    </View>
                    <View style={styles.flex1}>
                      <Text style={styles.editorLabel}>行李轉盤</Text>
                      <TextInput
                        style={styles.gateInput}
                        value={baggageInput}
                        onChangeText={setBaggageInput}
                        placeholder="如 7"
                        placeholderTextColor={theme.textFaint}
                      />
                    </View>
                  </View>
                  <ActionButton
                    variant="primary"
                    label="儲存修改"
                    busyLabel="儲存中…"
                    onPress={handleSaveGates}
                  />
                </View>
              ) : null}
              {/* Airport & Route Quick Map Link */}
              <PressScale
                style={styles.viewOnMapBtn}
                onPress={() => {
                  onClose();
                  onViewOnMap?.(flight);
                }}
              >
                <Text style={styles.viewOnMapText}>🗺️ 在地圖上查看此航線</Text>
              </PressScale>
            </View>

            {/* Live Sync Action */}
            <View style={styles.syncRow}>
              <ActionButton
                variant="secondary"
                label="🔄 檢查最新航班動態"
                busyLabel="查詢中…"
                onPress={handleSyncStatus}
              />
            </View>

            {/* Flight Details: Airline, Seat, PNR, Notes */}
            <View style={styles.card}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>航空公司</Text>
                <Text style={styles.detailValue}>
                  {flight.airlineName} {flight.alliance ? `· ${flight.alliance}` : ''}
                </Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>座位 (Seat)</Text>
                <Text style={styles.detailValue}>{flight.seat ?? '未指定'}</Text>
              </View>

              {flight.pnr ? (
                <>
                  <View style={styles.divider} />
                  <PressScale
                    style={styles.detailRow}
                    onPress={() => setPnrEnlarged((v) => !v)}
                  >
                    <Text style={styles.detailLabel}>訂位代號 (PNR)</Text>
                    <View style={styles.pnrBadge}>
                      <Text style={styles.pnrHighlight}>{flight.pnr}</Text>
                      <Text style={styles.pnrZoomHint}>🔍 放大</Text>
                    </View>
                  </PressScale>

                  {pnrEnlarged ? (
                    <View style={styles.pnrEnlargedBox}>
                      <Text style={styles.pnrEnlargedLabel}>出示給地勤人員快速報到：</Text>
                      <Text style={styles.pnrEnlargedCode}>{flight.pnr}</Text>
                    </View>
                  ) : null}
                </>
              ) : null}

              {flight.notes ? (
                <>
                  <View style={styles.divider} />
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>備註</Text>
                    <Text style={styles.notesText}>{flight.notes}</Text>
                  </View>
                </>
              ) : null}
            </View>

            {/* Travel Docs Section */}
            <View style={styles.card}>
              <View style={styles.docsHeader}>
                <View style={styles.docsTitleRow}>
                  <Text style={styles.tzSectionTitle}>電子機票與文件</Text>
                  {docs.length > 0 ? (
                    <View style={styles.docsCountBadge}>
                      <Text style={styles.docsCountText}>{docs.length}</Text>
                    </View>
                  ) : null}
                </View>
                <PressScale style={styles.addDocBtn} onPress={handleAddDoc}>
                  <Text style={styles.addDocBtnText}>＋ 附加文件</Text>
                </PressScale>
              </View>

              {docs.length === 0 ? (
                <Text style={styles.emptyDocsText}>
                  尚未附加機票 PDF 或相片，點擊右上角新增。
                </Text>
              ) : (
                <View style={styles.docsList}>
                  {docs.map((doc) => (
                    <View key={doc.id} style={styles.docItem}>
                      <PressScale
                        style={styles.docItemMain}
                        onPress={() => void handleOpenDoc(doc)}
                      >
                        <Text style={styles.docIcon}>
                          {doc.mimeType.includes('pdf') ? '📄' : '🖼️'}
                        </Text>
                        <View style={styles.docTextCol}>
                          <Text style={styles.docName} numberOfLines={1}>
                            {doc.fileName}
                          </Text>
                          <Text style={styles.docDate}>點擊預覽與分享</Text>
                        </View>
                      </PressScale>
                      <PressScale
                        style={styles.docDeleteBtn}
                        onPress={() => void handleDeleteDoc(doc)}
                        hitSlop={8}
                      >
                        <Text style={styles.docDeleteText}>✕</Text>
                      </PressScale>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* On Arrival Timezone Card */}
            <View style={styles.card}>
              <Text style={styles.tzSectionTitle}>抵達當地 (On Arrival)</Text>
              <Text style={styles.tzHeadline}>{tzSummary.headline}</Text>
              <Text style={styles.tzDesc}>{tzSummary.description}</Text>
              <View style={styles.tzBadgeContainer}>
                <Text style={styles.tzBadge}>{tzSummary.badge}</Text>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.bottomActions}>
              <ActionButton
                variant="secondary"
                label={flight.isFinished ? '移回「即將出發」' : '標記為「已完成」'}
                busyLabel="更新中…"
                onPress={toggleFinished}
              />
              <PressScale style={styles.deleteButton} onPress={handleDelete} hitSlop={6}>
                <Text style={styles.deleteButtonText}>刪除此航班</Text>
              </PressScale>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  scrimDismiss: {
    flex: 1,
  },
  sheet: {
    backgroundColor: theme.cardDark,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flightNumber: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: theme.accentSoft,
  },
  statusBadgeFinished: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  statusBadgeText: {
    color: theme.text,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerRoute: {
    color: theme.textFaint,
    fontSize: 12,
    marginTop: 3,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  scroll: {
    maxHeight: 560,
  },
  content: {
    padding: 20,
    gap: 14,
  },
  card: {
    backgroundColor: theme.surfaceSolid,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: 16,
    gap: 12,
  },
  airportsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  airportCol: {
    alignItems: 'flex-start',
    gap: 3,
  },
  alignRight: {
    alignItems: 'flex-end',
  },
  airportFlag: {
    fontSize: 20,
  },
  airportIata: {
    color: theme.text,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  timeText: {
    color: theme.onTimeGreen,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cityText: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  signBadge: {
    backgroundColor: theme.airportSignBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sign,
    marginTop: 4,
  },
  signBadgeText: {
    color: theme.airportSignText,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  flightMiddleCol: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
    paddingHorizontal: 12,
  },
  durationText: {
    color: theme.textFaint,
    fontSize: 11,
    fontWeight: '700',
  },
  routeLine: {
    height: 2,
    width: '100%',
    backgroundColor: theme.accent,
    borderRadius: 1,
  },
  milesText: {
    color: theme.textFaint,
    fontSize: 11,
    fontWeight: '600',
  },
  baggageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  baggageIcon: {
    fontSize: 14,
  },
  baggageText: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  viewOnMapBtn: {
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
    borderRadius: radius.card - 4,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  viewOnMapText: {
    color: '#818cf8',
    fontSize: 13,
    fontWeight: '700',
  },
  gateEditorBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: radius.card - 4,
    padding: 12,
    gap: 10,
    marginTop: 4,
  },
  gateEditorTitle: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  gateEditorInputs: {
    flexDirection: 'row',
    gap: 8,
  },
  flex1: {
    flex: 1,
    gap: 4,
  },
  editorLabel: {
    color: theme.textFaint,
    fontSize: 10,
    fontWeight: '700',
  },
  gateInput: {
    backgroundColor: theme.surfaceElevated,
    borderRadius: radius.card - 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  syncRow: {
    paddingHorizontal: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailCol: {
    gap: 4,
  },
  detailLabel: {
    color: theme.textFaint,
    fontSize: 12,
    fontWeight: '600',
  },
  detailValue: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  pnrBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pnrHighlight: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  pnrZoomHint: {
    color: theme.textFaint,
    fontSize: 10,
    fontWeight: '600',
  },
  pnrEnlargedBox: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: radius.card,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    marginTop: 4,
  },
  pnrEnlargedLabel: {
    color: '#bae6fd',
    fontSize: 11,
    fontWeight: '600',
  },
  pnrEnlargedCode: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 6,
  },
  notesText: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  docsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  docsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  docsCountBadge: {
    backgroundColor: theme.docsBadgePurple,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  docsCountText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  addDocBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  addDocBtnText: {
    color: theme.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyDocsText: {
    color: theme.textFaint,
    fontSize: 12,
    fontStyle: 'italic',
  },
  docsList: {
    gap: 8,
  },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: radius.card - 4,
    padding: 10,
  },
  docItemMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  docIcon: {
    fontSize: 20,
  },
  docTextCol: {
    flex: 1,
    gap: 2,
  },
  docName: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  docDate: {
    color: theme.textFaint,
    fontSize: 10,
  },
  docDeleteBtn: {
    padding: 6,
  },
  docDeleteText: {
    color: theme.textFaint,
    fontSize: 13,
    fontWeight: '700',
  },
  tzSectionTitle: {
    color: theme.textFaint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  tzHeadline: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  tzDesc: {
    color: theme.textMuted,
    fontSize: 12,
  },
  tzBadgeContainer: {
    alignSelf: 'flex-start',
    backgroundColor: theme.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sign,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  tzBadge: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '800',
  },
  bottomActions: {
    gap: 12,
    marginTop: 4,
    marginBottom: 20,
  },
  deleteButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: theme.danger,
    fontSize: 13,
    fontWeight: '700',
  },
});
