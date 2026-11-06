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
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { findAirport } from '../flights/airports';
import {
  buildFlightFromForm,
  EMPTY_FLIGHT_FORM,
  formFromLeg,
  type FlightForm,
} from '../flights/flightForm';
import {
  parseItineraryTextOffline,
  parseTicketWithGemini,
  type GeminiExtractedLeg,
} from '../flights/geminiParser';
import type { FlightRecord } from '../flights/types';
import { database } from '../store/database';
import { expoDocFiles } from '../store/expoDocFiles';
import { attachFlightDoc } from '../store/flightDocs';
import { insertFlight } from '../store/flights';
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

async function fileUriToBase64(uri: string): Promise<string> {
  const file = new File(uri);
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
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

  const setField = useCallback(
    <K extends keyof FlightForm>(key: K) =>
      (value: FlightForm[K]) =>
        setForm((f) => ({ ...f, [key]: value })),
    [],
  );

  // A parse replaces the whole form, empty fields included, so nothing from
  // an earlier ticket survives into this one. Only the user's own notes stay.
  const applyLeg = useCallback((leg: GeminiExtractedLeg) => {
    setForm((f) => ({ ...formFromLeg(leg), notes: f.notes }));
  }, []);

  const reset = useCallback(() => {
    setForm(EMPTY_FLIGHT_FORM);
    setAttachedDoc(null);
    setPastedText('');
    setErrorMsg(null);
    setEntryMode('manual');
  }, []);

  const handleAiParseText = useCallback(async () => {
    setErrorMsg(null);
    if (!pastedText.trim()) {
      setErrorMsg('請先貼上機票或訂位確認文字');
      return { ok: false as const };
    }

    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

    try {
      let legs = apiKey
        ? await parseTicketWithGemini({ text: pastedText }, apiKey)
        : parseItineraryTextOffline(pastedText);

      if (!legs || legs.length === 0) {
        legs = parseItineraryTextOffline(pastedText);
      }

      if (!legs || legs.length === 0) {
        setErrorMsg('未能從文字中辨識出航班資訊，請改用手動輸入');
        return { ok: false as const };
      }

      const leg = legs[0];
      applyLeg(leg);

      setEntryMode('manual');
      return { ok: true as const, message: `已辨識 ${leg.flightNumber}` };
    } catch (err) {
      // Fallback to offline regex
      const offlineLegs = parseItineraryTextOffline(pastedText);
      if (offlineLegs.length > 0) {
        const leg = offlineLegs[0];
        applyLeg(leg);
        setEntryMode('manual');
        return { ok: true as const, message: `已離線辨識 ${leg.flightNumber}` };
      }

      setErrorMsg(err instanceof Error ? err.message : String(err));
      return { ok: false as const };
    }
  }, [pastedText, applyLeg]);

  const handlePickDocument = useCallback(async () => {
    setErrorMsg(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return { ok: false as const };
      }

      const asset = result.assets[0];
      const docInfo: AttachedDoc = {
        name: asset.name,
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'application/pdf',
        size: asset.size,
      };
      setAttachedDoc(docInfo);

      const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        setErrorMsg('已附加文件。未設定 Gemini API Key，請手動確認航班資訊。');
        setEntryMode('manual');
        return { ok: true as const, message: `已附加 ${asset.name}` };
      }

      const base64Data = await fileUriToBase64(asset.uri);
      const legs = await parseTicketWithGemini(
        { base64Data, mimeType: docInfo.mimeType },
        apiKey,
      );

      if (legs && legs.length > 0) {
        const leg = legs[0];
        applyLeg(leg);
        setEntryMode('manual');
        return { ok: true as const, message: `已辨識 ${leg.flightNumber}` };
      }

      setErrorMsg('未能從文件自動辨識航班，但已附加檔案，請手動確認欄位。');
      setEntryMode('manual');
      return { ok: false as const };
    } catch (err) {
      setErrorMsg(`文件解析失敗: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false as const };
    }
  }, [applyLeg]);

  const handlePickImage = useCallback(async () => {
    setErrorMsg(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        base64: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return { ok: false as const };
      }

      const asset = result.assets[0];
      const fileName = asset.fileName ?? `boarding_pass_${Date.now()}.jpg`;
      const docInfo: AttachedDoc = {
        name: fileName,
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        size: asset.fileSize,
      };
      setAttachedDoc(docInfo);

      const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        setErrorMsg('已附加照片。未設定 Gemini API Key，請手動確認航班資訊。');
        setEntryMode('manual');
        return { ok: true as const, message: `已選取照片` };
      }

      let base64Data = asset.base64;
      if (!base64Data) {
        base64Data = await fileUriToBase64(asset.uri);
      }

      const legs = await parseTicketWithGemini(
        { base64Data, mimeType: docInfo.mimeType },
        apiKey,
      );

      if (legs && legs.length > 0) {
        const leg = legs[0];
        applyLeg(leg);
        setEntryMode('manual');
        return { ok: true as const, message: `已辨識 ${leg.flightNumber}` };
      }

      setErrorMsg('未能從相片辨識航班，但已附加照片，請手動輸入欄位。');
      setEntryMode('manual');
      return { ok: false as const };
    } catch (err) {
      setErrorMsg(`相片辨識失敗: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false as const };
    }
  }, [applyLeg]);

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
      await insertFlight(db, flight);

      if (attachedDoc) {
        await attachFlightDoc(db, expoDocFiles, {
          id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          flightId: flight.id,
          sourceUri: attachedDoc.uri,
          fileName: attachedDoc.name,
          mimeType: attachedDoc.mimeType,
          now: Date.now(),
        });
      }

      onFlightAdded(flight);
      // The sheet stays mounted between adds; without this the next flight
      // would get this one's ticket attached and could be saved twice.
      reset();
      onClose();
      return { ok: true as const, message: '已加入旅途' };
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return { ok: false as const };
    }
  }, [form, attachedDoc, onFlightAdded, onClose, reset]);

  const unknownAirport = (iata: string) => {
    const code = iata.trim().toUpperCase();
    return code.length === 3 && !findAirport(code) ? code : null;
  };
  const depUnknown = unknownAirport(form.depIata);
  const arrUnknown = unknownAirport(form.arrIata);

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
              <Text style={styles.subtitle}>加入即將出發或歷史飛行記錄</Text>
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
                ✨ 智慧機票辨識
              </Text>
            </PressScale>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.formContent}>
            {errorMsg ? <Text style={styles.errorBanner}>{errorMsg}</Text> : null}

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
                    <Text style={styles.attachedDocStatus}>
                      已附加至航班（儲存時自動關聯）
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
                <Text style={styles.label}>方式 1：選取電子機票檔案或登機證相片</Text>
                <View style={styles.fileButtonsRow}>
                  <View style={styles.flex1}>
                    <ActionButton
                      variant="secondary"
                      label="📄 選取 PDF 機票"
                      busyLabel="讀取中…"
                      onPress={handlePickDocument}
                    />
                  </View>
                  <View style={styles.flex1}>
                    <ActionButton
                      variant="secondary"
                      label="🖼️ 相簿登機證"
                      busyLabel="讀取中…"
                      onPress={handlePickImage}
                    />
                  </View>
                </View>

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>或直接貼上文字</Text>
                  <View style={styles.dividerLine} />
                </View>

                <Text style={styles.label}>方式 2：貼上機票或訂位確認文字</Text>
                <TextInput
                  style={[styles.input, styles.aiInput]}
                  value={pastedText}
                  onChangeText={setPastedText}
                  placeholder="例如：長榮航空 BR198 台北 (TPE) 到 東京 (NRT) 2026-12-31 座位 10K PNR 8YK2MP..."
                  placeholderTextColor={theme.textFaint}
                  multiline
                  numberOfLines={4}
                />
                <ActionButton
                  variant="primary"
                  label="✨ 自動辨識文字並填入"
                  busyLabel="解析中…"
                  onPress={handleAiParseText}
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
                    <Text style={styles.label}>起飛機場 (IATA)</Text>
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
                    <Text style={styles.label}>抵達機場 (IATA)</Text>
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

                {depUnknown || arrUnknown ? (
                  <View style={styles.fieldRow}>
                    {depUnknown ? (
                      <View style={styles.flex1}>
                        <Text style={styles.label}>{depUnknown} 當地時區 (UTC±)</Text>
                        <TextInput
                          style={styles.input}
                          value={form.depUtcOffset}
                          onChangeText={setField('depUtcOffset')}
                          placeholder="如 +9"
                          placeholderTextColor={theme.textFaint}
                        />
                      </View>
                    ) : (
                      <View style={styles.flex1} />
                    )}
                    {arrUnknown ? (
                      <View style={styles.flex1}>
                        <Text style={styles.label}>{arrUnknown} 當地時區 (UTC±)</Text>
                        <TextInput
                          style={styles.input}
                          value={form.arrUtcOffset}
                          onChangeText={setField('arrUtcOffset')}
                          placeholder="如 -5"
                          placeholderTextColor={theme.textFaint}
                        />
                      </View>
                    ) : (
                      <View style={styles.flex1} />
                    )}
                  </View>
                ) : null}

                <View style={styles.fieldRow}>
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
                  <View style={styles.flex1}>
                    <Text style={styles.label}>訂位代號 (PNR)</Text>
                    <TextInput
                      style={styles.input}
                      value={form.pnr}
                      onChangeText={setField('pnr')}
                      placeholder="如 7X9K2M"
                      placeholderTextColor={theme.textFaint}
                      autoCapitalize="characters"
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>備註 (Notes)</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={form.notes}
                    onChangeText={setField('notes')}
                    placeholder="選位、特別餐或旅行備忘錄..."
                    placeholderTextColor={theme.textFaint}
                    multiline
                    numberOfLines={3}
                  />
                </View>

                {!attachedDoc ? (
                  <View style={styles.attachQuickRow}>
                    <PressScale style={styles.attachBtn} onPress={handlePickDocument}>
                      <Text style={styles.attachBtnText}>📎 附加電子機票 (PDF / 圖檔)</Text>
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
  fileButtonsRow: {
    flexDirection: 'row',
    gap: 10,
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
  attachedDocStatus: {
    color: theme.accent,
    fontSize: 10,
    fontWeight: '600',
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
  subtitle: {
    color: theme.textFaint,
    fontSize: 12,
    marginTop: 2,
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
