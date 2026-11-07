import { memo, useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { expoTicketReader } from '../flights/expoTicketReader';
import { airportLabel, airportTime } from '../flights/flightDisplay';
import {
  buildFlightFromForm,
  cleanFlightNumber,
  editForm,
  EMPTY_FLIGHT_FORM,
  formFromTicket,
  legsFoundMessage,
  type FlightForm,
} from '../flights/flightForm';
import { createAeroDataBoxPort } from '../flights/flightStatusApi';
import { readTicket } from '../flights/readTicket';
import { extractTickets, type TicketFacts } from '../flights/ticketFacts';
import type { FlightRecord, LookedUpFlight } from '../flights/types';
import { normalizeDate } from '../flights/zonedTime';
import { apiKey } from '../settings/expoKeyStore';
import { database } from '../store/database';
import { expoDocFiles } from '../store/expoDocFiles';
import { saveNewFlight } from '../store/flightDocs';
import { ActionButton } from './ActionButton';
import { PressScale } from './PressScale';
import { radius, theme } from './theme';

interface AddFlightSheetProps {
  visible: boolean;
  onClose: () => void;
  onFlightAdded: (flight: FlightRecord) => void;
}

interface AttachedDoc {
  name: string;
  uri: string;
  mimeType: string;
  size?: number;
}

/** Everything else about a flight, from its number and date. */
async function lookUp(
  ticket: TicketFacts,
): Promise<{ legs: LookedUpFlight[]; notice: string | null }> {
  const key = await apiKey('flightStatus');
  if (!key) return { legs: [], notice: '請先到「我的 › 設定」填航班 API 金鑰' };

  const date = ticket.date && normalizeDate(ticket.date);
  if (!date) return { legs: [], notice: '請填起飛日期再查詢' };

  const legs = await createAeroDataBoxPort(key).findFlights(ticket.flightNumber, date);
  return { legs, notice: legs.length === 0 ? '查不到這班航班，請手動填寫' : null };
}

export const AddFlightSheet = memo(function AddFlightSheet({
  visible,
  onClose,
  onFlightAdded,
}: AddFlightSheetProps) {
  const [entryMode, setEntryMode] = useState<'manual' | 'ai'>('manual');
  const [pastedText, setPastedText] = useState('');
  const [attachedDoc, setAttachedDoc] = useState<AttachedDoc | null>(null);
  // Starts empty: every value a saved flight carries was typed or read off a
  // ticket. See flights/flightForm.ts for what the sheet used to make up.
  const [form, setForm] = useState<FlightForm>(EMPTY_FLIGHT_FORM);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // A ticket can hold several flights and the form shows one: the rest wait
  // here, and each is filled in after the one before it is saved.
  const [pendingTickets, setPendingTickets] = useState<TicketFacts[]>([]);

  // Only when a lookup found nothing does the sheet ask for the rest by hand.
  const [needsTyping, setNeedsTyping] = useState(false);

  const setField = useCallback(
    <K extends keyof FlightForm>(key: K) =>
      (value: FlightForm[K]) =>
        setForm((f) => editForm(f, key, value)),
    [],
  );

  /**
   * Fills the form for the first ticket and queues the rest. A new ticket starts
   * from an empty form, so nothing of the last one survives into it; only the
   * user's own notes stay. `keepTyped` is the 查詢 button, which works on the form
   * as it stands.
   */
  const showTicket = useCallback(
    async ([ticket, ...rest]: TicketFacts[], keepTyped = false) => {
      const { legs, notice } = await lookUp(ticket);
      setForm((f) =>
        formFromTicket(ticket, legs, keepTyped ? f : { ...EMPTY_FLIGHT_FORM, notes: f.notes }),
      );
      setPendingTickets(rest);
      setNeedsTyping(legs.length === 0);
      setEntryMode('manual');
      setErrorMsg(notice ?? (ticket.yearGuessed ? '票面沒印年份，請確認日期' : null));
    },
    [],
  );

  const reset = useCallback(() => {
    setPendingTickets([]);
    setNeedsTyping(false);
    setForm(EMPTY_FLIGHT_FORM);
    setAttachedDoc(null);
    setPastedText('');
    setErrorMsg(null);
    setEntryMode('manual');
  }, []);

  const readInto = useCallback(
    async (tickets: TicketFacts[]) => {
      if (tickets.length === 0) {
        setErrorMsg('辨識不到航班，請手動填寫');
        setEntryMode('manual');
        return { ok: false as const };
      }
      await showTicket(tickets);
      return { ok: true as const, message: legsFoundMessage(tickets) };
    },
    [showTicket],
  );

  const handleReadText = useCallback(async () => {
    setErrorMsg(null);
    if (!pastedText.trim()) {
      setErrorMsg('請先貼上機票或訂位確認文字');
      return { ok: false as const };
    }
    try {
      return await readInto(extractTickets([pastedText], Date.now()));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return { ok: false as const };
    }
  }, [pastedText, readInto]);

  const pickImage = useCallback(async () => {
    setErrorMsg(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
      if (result.canceled || !result.assets || result.assets.length === 0) {
        return { ok: false as const };
      }
      return await readInto(await readTicket(expoTicketReader, result.assets[0].uri, Date.now()));
    } catch (err) {
      setErrorMsg(`辨識失敗：${err instanceof Error ? err.message : String(err)}`);
      return { ok: false as const };
    }
  }, [readInto]);

  const handleLookUp = useCallback(async () => {
    setErrorMsg(null);
    const flightNumber = cleanFlightNumber(form.flightNumber);
    if (!flightNumber) {
      setErrorMsg('請填寫航班編號');
      return { ok: false as const };
    }
    try {
      await showTicket(
        [
          {
            flightNumber,
            date: form.depDate.trim() || null,
            time: form.depTime.trim() || null,
            seat: null,
            yearGuessed: false,
          },
        ],
        true,
      );
      return { ok: true as const, message: '已查詢' };
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return { ok: false as const };
    }
  }, [form.flightNumber, form.depDate, form.depTime, showTicket]);

  const handleAttachDoc = useCallback(async () => {
    setErrorMsg(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const asset = result.assets[0];
      setAttachedDoc({
        name: asset.name,
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'application/pdf',
        size: asset.size,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleSave = useCallback(async () => {
    setErrorMsg(null);
    const id = `fl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const result = buildFlightFromForm(form, Date.now(), id);
    if (!result.ok) {
      setErrorMsg(result.error);
      return { ok: false as const };
    }
    const { flight } = result;

    try {
      const db = await database();
      await saveNewFlight(
        db,
        expoDocFiles,
        flight,
        attachedDoc && {
          id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sourceUri: attachedDoc.uri,
          fileName: attachedDoc.name,
          mimeType: attachedDoc.mimeType,
          now: Date.now(),
        },
      );

      onFlightAdded(flight);

      if (pendingTickets.length > 0) {
        // The same ticket covers the next leg, so it stays attached.
        await showTicket(pendingTickets);
        return { ok: true as const, message: `已加入 ${flight.flightNumber}` };
      }

      // The sheet stays mounted between adds; without this the next flight
      // would get this one's ticket attached and could be saved twice.
      reset();
      onClose();
      return { ok: true as const, message: '已加入旅途' };
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return { ok: false as const };
    }
  }, [form, attachedDoc, pendingTickets, showTicket, onFlightAdded, onClose, reset]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.scrim}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.scrimDismiss} onPress={onClose}>
          <View />
        </Pressable>

        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>新增航班</Text>
            </View>
            <PressScale style={styles.closeButton} onPress={onClose} hitSlop={8}>
              <Text style={styles.closeText}>✕</Text>
            </PressScale>
          </View>

          <View style={styles.modeTabs}>
            <PressScale
              containerStyle={styles.modeSlot}
              style={[styles.modeTab, entryMode === 'manual' && styles.modeTabActive]}
              onPress={() => setEntryMode('manual')}
            >
              <Text style={[styles.modeTabText, entryMode === 'manual' && styles.modeTabTextActive]}>
                ✍️ 手動輸入
              </Text>
            </PressScale>
            <PressScale
              containerStyle={styles.modeSlot}
              style={[styles.modeTab, entryMode === 'ai' && styles.modeTabActive]}
              onPress={() => setEntryMode('ai')}
            >
              <Text style={[styles.modeTabText, entryMode === 'ai' && styles.modeTabTextActive]}>
                ✨ 機票辨識
              </Text>
            </PressScale>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.formContent}>
            {errorMsg ? <Text style={styles.errorBanner}>{errorMsg}</Text> : null}

            {pendingTickets.length > 0 ? (
              <View style={styles.legQueue}>
                <Text style={styles.legQueueText}>
                  還有 {pendingTickets.length} 段航班，這段儲存後接著填入
                </Text>
                <PressScale onPress={() => void showTicket(pendingTickets)} hitSlop={8}>
                  <Text style={styles.attachedDocRemove}>略過這段</Text>
                </PressScale>
              </View>
            ) : null}

            {attachedDoc ? (
              <View style={styles.attachedDocCard}>
                <View style={styles.attachedDocInfo}>
                  <Text style={styles.attachedDocIcon}>
                    {attachedDoc.mimeType.includes('pdf') ? '📄' : '🖼️'}
                  </Text>
                  <View style={styles.attachedDocTextCol}>
                    <Text style={styles.attachedDocName} numberOfLines={1}>
                      {attachedDoc.name}
                    </Text>
                  </View>
                </View>
                <PressScale onPress={() => setAttachedDoc(null)} hitSlop={8}>
                  <Text style={styles.attachedDocRemove}>✕ 移除</Text>
                </PressScale>
              </View>
            ) : null}

            {entryMode === 'ai' ? (
              <View style={styles.aiBox}>
                <ActionButton
                  variant="secondary"
                  label="🖼️ 選擇截圖或照片"
                  busyLabel="辨識中…"
                  onPress={pickImage}
                />

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>或貼上文字</Text>
                  <View style={styles.dividerLine} />
                </View>

                <TextInput
                  style={[styles.input, styles.aiInput]}
                  value={pastedText}
                  onChangeText={setPastedText}
                  placeholder="機票或訂位確認文字"
                  placeholderTextColor={theme.textFaint}
                  multiline
                  numberOfLines={4}
                />
                <ActionButton
                  variant="primary"
                  label="✨ 辨識"
                  busyLabel="解析中…"
                  onPress={handleReadText}
                />
              </View>
            ) : (
              <>
                <View style={styles.fieldRow}>
                  <View style={styles.flex1}>
                    <Text style={styles.label}>航班編號</Text>
                    <TextInput
                      style={styles.input}
                      value={form.flightNumber}
                      onChangeText={setField('flightNumber')}
                      placeholder="如 CI501"
                      placeholderTextColor={theme.textFaint}
                      autoCapitalize="characters"
                    />
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.label}>起飛日期（當地）</Text>
                    <TextInput
                      style={styles.input}
                      value={form.depDate}
                      onChangeText={setField('depDate')}
                      placeholder="2026-12-01"
                      placeholderTextColor={theme.textFaint}
                    />
                  </View>
                </View>

                <ActionButton
                  variant="primary"
                  label="🔎 查詢"
                  busyLabel="查詢中…"
                  disabled={form.flightNumber.trim() === '' || form.depDate.trim() === ''}
                  onPress={handleLookUp}
                />

                {form.lookedUp ? (
                  <View style={styles.lookedUp}>
                    <Text style={styles.lookedUpRoute}>
                      {airportLabel(form.lookedUp.depCity, form.lookedUp.depIata)} →{' '}
                      {airportLabel(form.lookedUp.arrCity, form.lookedUp.arrIata)}
                    </Text>
                    <Text style={styles.lookedUpDetail}>
                      {form.lookedUp.airlineName} ·{' '}
                      {airportTime(form.lookedUp.depScheduledUtc, form.lookedUp.depTz)} –{' '}
                      {airportTime(form.lookedUp.arrScheduledUtc, form.lookedUp.arrTz)}
                    </Text>
                  </View>
                ) : null}

                {needsTyping && !form.lookedUp ? (
                  <>
                  <View style={styles.fieldRow}>
                    <View style={styles.flex1}>
                      <Text style={styles.label}>航空公司</Text>
                      <TextInput
                        style={styles.input}
                        value={form.airlineName}
                        onChangeText={setField('airlineName')}
                        placeholder="如 中華航空"
                        placeholderTextColor={theme.textFaint}
                      />
                    </View>
                  </View>

                  <View style={styles.fieldRow}>
                    <View style={styles.flex1}>
                      <Text style={styles.label}>起飛機場</Text>
                      <TextInput
                        style={styles.input}
                        value={form.depIata}
                        onChangeText={setField('depIata')}
                        placeholder="TPE"
                        placeholderTextColor={theme.textFaint}
                        autoCapitalize="characters"
                        maxLength={3}
                      />
                    </View>
                    <View style={styles.flex1}>
                      <Text style={styles.label}>抵達機場</Text>
                      <TextInput
                        style={styles.input}
                        value={form.arrIata}
                        onChangeText={setField('arrIata')}
                        placeholder="PVG"
                        placeholderTextColor={theme.textFaint}
                        autoCapitalize="characters"
                        maxLength={3}
                      />
                    </View>
                  </View>

                  <View style={styles.fieldRow}>
                    <View style={styles.flex1}>
                      <Text style={styles.label}>起飛地 UTC 偏移</Text>
                      <TextInput
                        style={styles.input}
                        value={form.depUtcOffset}
                        onChangeText={setField('depUtcOffset')}
                        placeholder="+8"
                        placeholderTextColor={theme.textFaint}
                      />
                    </View>
                    <View style={styles.flex1}>
                      <Text style={styles.label}>抵達地 UTC 偏移</Text>
                      <TextInput
                        style={styles.input}
                        value={form.arrUtcOffset}
                        onChangeText={setField('arrUtcOffset')}
                        placeholder="+9"
                        placeholderTextColor={theme.textFaint}
                      />
                    </View>
                  </View>

                  <View style={styles.fieldRow}>
                    <View style={styles.flex1}>
                      <Text style={styles.label}>起飛時間（當地）</Text>
                      <TextInput
                        style={styles.input}
                        value={form.depTime}
                        onChangeText={setField('depTime')}
                        placeholder="07:30"
                        placeholderTextColor={theme.textFaint}
                      />
                    </View>
                    <View style={styles.flex1}>
                      <Text style={styles.label}>抵達時間（當地）</Text>
                      <TextInput
                        style={styles.input}
                        value={form.arrTime}
                        onChangeText={setField('arrTime')}
                        placeholder="11:45"
                        placeholderTextColor={theme.textFaint}
                      />
                    </View>
                  </View>

                  <View style={styles.fieldRow}>
                    <View style={styles.flex1}>
                      <Text style={styles.label}>抵達日期（當地）</Text>
                      <TextInput
                        style={styles.input}
                        value={form.arrDate}
                        onChangeText={setField('arrDate')}
                        placeholder={form.depDate || '同起飛日'}
                        placeholderTextColor={theme.textFaint}
                      />
                    </View>
                  </View>
                  </>
                ) : null}

                <View style={styles.fieldRow}>
                  <View style={styles.flex1}>
                    <Text style={styles.label}>座位號碼</Text>
                    <TextInput
                      style={styles.input}
                      value={form.seat}
                      onChangeText={setField('seat')}
                      placeholder="如 24A"
                      placeholderTextColor={theme.textFaint}
                      autoCapitalize="characters"
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>備註</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={form.notes}
                    onChangeText={setField('notes')}
                    multiline
                    numberOfLines={3}
                  />
                </View>

                {!attachedDoc ? (
                  <View style={styles.attachQuickRow}>
                    <PressScale style={styles.attachBtn} onPress={handleAttachDoc}>
                      <Text style={styles.attachBtnText}>📎 附加機票</Text>
                    </PressScale>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  <ActionButton
                    variant="primary"
                    label="確認加入"
                    busyLabel="儲存中…"
                    onPress={handleSave}
                  />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  lookedUp: {
    gap: 4,
    padding: 12,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  lookedUpRoute: { color: theme.text, fontSize: 15, fontWeight: '600' },
  lookedUpDetail: { color: theme.textMuted, fontSize: 13 },
  legQueue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  legQueueText: { color: theme.textMuted, fontSize: 13, flexShrink: 1 },
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
    maxHeight: '85%',
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
  modeTabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    padding: 3,
    borderRadius: radius.card,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    gap: 4,
  },
  modeSlot: {
    flex: 1,
  },
  modeTab: {
    paddingVertical: 8,
    borderRadius: radius.card - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabActive: {
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accent,
  },
  modeTabText: {
    color: theme.textFaint,
    fontSize: 12,
    fontWeight: '600',
  },
  modeTabTextActive: {
    color: theme.text,
    fontWeight: '700',
  },
  aiBox: {
    gap: 12,
    paddingVertical: 6,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
  },
  dividerText: {
    color: theme.textFaint,
    fontSize: 11,
    fontWeight: '600',
  },
  aiInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  attachedDocCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.35)',
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  attachedDocInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  attachedDocIcon: {
    fontSize: 20,
  },
  attachedDocTextCol: {
    flex: 1,
    gap: 2,
  },
  attachedDocName: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  attachedDocRemove: {
    color: theme.danger,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  attachQuickRow: {
    marginTop: 4,
  },
  attachBtn: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  attachBtnText: {
    color: theme.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '800',
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
    maxHeight: 520,
  },
  formContent: {
    padding: 20,
    gap: 14,
  },
  errorBanner: {
    color: theme.danger,
    fontSize: 12,
    backgroundColor: 'rgba(255, 157, 157, 0.1)',
    padding: 10,
    borderRadius: 8,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  flex1: {
    flex: 1,
    gap: 6,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    color: theme.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: theme.surfaceSolid,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  textArea: {
    height: 72,
    textAlignVertical: 'top',
  },
  actions: {
    marginTop: 10,
    marginBottom: 20,
  },
});
