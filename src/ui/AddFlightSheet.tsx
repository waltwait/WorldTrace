import { memo, useCallback, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { expoTicketReader } from '../flights/expoTicketReader';
import { ticketFor } from '../flights/flightDisplay';
import {
  buildFlightFromForm,
  cleanFlightNumber,
  editForm,
  EMPTY_FLIGHT_FORM,
  formFromTicket,
  legsFoundMessage,
  type FlightForm,
} from '../flights/flightForm';
import { lookUpFlight } from '../flights/flightLookup';
import { createAeroDataBoxPort } from '../flights/flightStatusApi';
import { readTicket } from '../flights/readTicket';
import type { TicketFacts } from '../flights/ticketFacts';
import type { FlightRecord, LookedUpFlight } from '../flights/types';
import { normalizeDate } from '../flights/zonedTime';
import { apiKey } from '../settings/expoKeyStore';
import { database } from '../store/database';
import { expoDocFiles } from '../store/expoDocFiles';
import { saveNewFlight } from '../store/flightDocs';
import { ActionButton } from './ActionButton';
import { DateField } from './DateField';
import { Icon } from './Icon';
import { PressScale } from './PressScale';
import { Ticket } from './Ticket';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, NOTO, radius, type Theme } from './themes';
import { Text, TextInput } from './Text';

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
  if (!key) return { legs: [], notice: '請先到「設定」填航班 API 金鑰' };

  const date = ticket.date && normalizeDate(ticket.date);
  if (!date) return { legs: [], notice: '請填起飛日期再查詢' };

  return lookUpFlight(createAeroDataBoxPort(key), ticket.flightNumber, date, Date.now());
}

export const AddFlightSheet = memo(function AddFlightSheet({
  visible,
  onClose,
  onFlightAdded,
}: AddFlightSheetProps) {
  const styles = useStyles(make);
  const t = useTheme();
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
      setErrorMsg(notice ?? (ticket.yearGuessed ? '票面沒印年份，請確認日期' : null));
    },
    [],
  );

  const reset = useCallback(() => {
    setPendingTickets([]);
    setNeedsTyping(false);
    setForm(EMPTY_FLIGHT_FORM);
    setAttachedDoc(null);
    setErrorMsg(null);
  }, []);

  const readInto = useCallback(
    async (tickets: TicketFacts[]) => {
      if (tickets.length === 0) {
        setErrorMsg('辨識不到航班，請手動填寫');
          return { ok: false as const };
      }
      await showTicket(tickets);
      return { ok: true as const, message: legsFoundMessage(tickets) };
    },
    [showTicket],
  );

  const pickImage = useCallback(async () => {
    setErrorMsg(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
      if (result.canceled || !result.assets || result.assets.length === 0) {
        return { ok: false as const };
      }
      return await readInto(await readTicket(expoTicketReader, result.assets[0].uri, Date.now()));
    } catch (err) {
      // What went wrong is for logcat. The screen only needs to say what to do.
      console.warn('[WorldTrace] ticket reading failed', err);
      setErrorMsg('辨識失敗，請再選一次');
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

  const preview = form.lookedUp ? buildFlightFromForm(form, Date.now(), 'preview') : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>新增航班</Text>
            <PressScale style={styles.close} onPress={onClose} label="關閉" hitSlop={8}>
              <Icon name="close" color={t.ink} size={20} />
            </PressScale>
          </View>

          <ActionButton
            variant="secondary"
            label="選擇截圖或照片"
            busyLabel="辨識中…"
            onPress={pickImage}
          />

          {errorMsg ? <Text style={styles.notice}>{errorMsg}</Text> : null}

          {pendingTickets.length > 0 ? (
            <View style={styles.queue}>
              <Text style={styles.queueText}>
                還有 {pendingTickets.length} 段航班，這段儲存後接著填入
              </Text>
              <PressScale onPress={() => void showTicket(pendingTickets)} hitSlop={8}>
                <Text style={styles.queueSkip}>略過這段</Text>
              </PressScale>
            </View>
          ) : null}

          <View style={styles.row}>
            <Field label="航班編號" value={form.flightNumber} onChange={setField('flightNumber')} placeholder="CI501" caps />
            <DateField label="起飛日期" value={form.depDate} onChange={setField('depDate')} placeholder="選擇日期" />
          </View>

          <ActionButton
            variant="primary"
            label="查詢"
            busyLabel="查詢中…"
            disabled={form.flightNumber.trim() === '' || form.depDate.trim() === ''}
            onPress={handleLookUp}
          />

          {preview?.ok ? (
            <Ticket
              ticket={ticketFor(preview.flight, Date.now())}
              heading={`${preview.flight.flightNumber} ${preview.flight.airlineName}`}
            />
          ) : null}

          {needsTyping && !form.lookedUp ? (
            <>
              <View style={styles.row}>
                <Field label="航空公司" value={form.airlineName} onChange={setField('airlineName')} placeholder="中華航空" chinese />
              </View>
              <View style={styles.row}>
                <Field label="起飛機場" value={form.depIata} onChange={setField('depIata')} placeholder="TPE" caps max={3} />
                <Field label="抵達機場" value={form.arrIata} onChange={setField('arrIata')} placeholder="NRT" caps max={3} />
              </View>
              <View style={styles.row}>
                <Field label="起飛地 UTC 偏移" value={form.depUtcOffset} onChange={setField('depUtcOffset')} placeholder="+8" />
                <Field label="抵達地 UTC 偏移" value={form.arrUtcOffset} onChange={setField('arrUtcOffset')} placeholder="+9" />
              </View>
              <View style={styles.row}>
                <Field label="起飛時間（當地）" value={form.depTime} onChange={setField('depTime')} placeholder="07:30" />
                <Field label="抵達時間（當地）" value={form.arrTime} onChange={setField('arrTime')} placeholder="11:45" />
              </View>
              <View style={styles.row}>
                <DateField label="抵達日期（當地）" value={form.arrDate} onChange={setField('arrDate')} placeholder={form.depDate || '同起飛日'} />
              </View>
            </>
          ) : null}

          <View style={styles.row}>
            <Field label="座位" value={form.seat} onChange={setField('seat')} placeholder="24A" caps />
            <Field label="備註" value={form.notes} onChange={setField('notes')} chinese />
          </View>

          {attachedDoc ? (
            <View style={styles.attached}>
              <Text style={styles.attachedName} numberOfLines={1}>
                {attachedDoc.name}
              </Text>
              <PressScale onPress={() => setAttachedDoc(null)} label="移除檔案" hitSlop={8}>
                <Icon name="close" color={t.muted} size={18} />
              </PressScale>
            </View>
          ) : (
            <PressScale style={styles.attachButton} onPress={handleAttachDoc}>
              <Text style={styles.attachText}>附加機票</Text>
            </PressScale>
          )}

          <ActionButton
            variant="primary"
            label="加入航班"
            busyLabel="儲存中…"
            onPress={handleSave}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
});

function Field({
  label,
  value,
  onChange,
  placeholder,
  caps = false,
  max,
  chinese = false,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  caps?: boolean;
  max?: number;
  /** For what is typed in Chinese. An input has one font, and Sora has no Chinese. */
  chinese?: boolean;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, chinese && styles.inputChinese]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        autoCapitalize={caps ? 'characters' : 'none'}
        maxLength={max}
      />
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { paddingHorizontal: 16, paddingTop: 48, paddingBottom: 32, gap: 14 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 6,
    },
    title: { color: t.ink, fontSize: 30, fontWeight: '900' },
    close: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    notice: {
      padding: 12,
      borderRadius: 16,
      backgroundColor: t.soft,
      color: t.ink,
      fontSize: 14,
    },
    queue: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: 12,
      borderRadius: 16,
      backgroundColor: t.soft,
    },
    queueText: { color: t.ink, fontSize: 14, flexShrink: 1 },
    queueSkip: { color: t.ink, fontSize: 14, fontWeight: '700' },
    row: { flexDirection: 'row', gap: 10 },
    field: { flex: 1, minWidth: 0, gap: 6 },
    label: { color: t.muted, fontSize: 13, paddingLeft: 6 },
    input: {
      height: 52,
      paddingHorizontal: 16,
      borderRadius: 18,
      backgroundColor: t.soft,
      color: t.ink,
      fontFamily: FONT.bold,
      fontSize: 17,
    },
    inputChinese: { fontFamily: NOTO.bold },
    attached: {
      minHeight: 48,
      paddingHorizontal: 16,
      borderRadius: 18,
      backgroundColor: t.soft,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    attachedName: { color: t.ink, fontSize: 15, flexShrink: 1 },
    attachButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    attachText: { color: t.ink, fontSize: 15 },
  });
