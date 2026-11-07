import { memo, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_KEYS, maskKey, saveApiKey, type ApiKeyName } from '../settings/apiKeys';
import { apiKey, expoKeyStore } from '../settings/expoKeyStore';
import { ActionButton } from './ActionButton';
import { ask } from './dialog';
import { PressScale } from './PressScale';
import { radius, theme } from './theme';

export const SettingsScreen = memo(function SettingsScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {API_KEYS.map(({ name, label }) => (
        <KeyRow key={name} name={name} label={label} />
      ))}
    </ScrollView>
  );
});

function KeyRow({ name, label }: { name: ApiKeyName; label: string }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    let cancelled = false;
    void apiKey(name).then((key) => {
      if (!cancelled) setSaved(key);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const fail = async (error: unknown) => {
    await ask({
      title: '無法儲存金鑰',
      message: error instanceof Error ? error.message : String(error),
      confirmLabel: '好',
    });
    return { ok: false as const };
  };

  const save = async () => {
    try {
      await saveApiKey(expoKeyStore, name, text);
      setSaved(text.trim());
      setText('');
      return { ok: true as const, message: '已儲存' };
    } catch (error) {
      return fail(error);
    }
  };

  const clear = async () => {
    const confirmed = await ask({
      title: `清除${label}`,
      message: '清除後要重新輸入才能使用。',
      confirmLabel: '清除',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await saveApiKey(expoKeyStore, name, '');
      setSaved(null);
    } catch (error) {
      await fail(error);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        {saved ? (
          <PressScale onPress={() => void clear()} hitSlop={8}>
            <Text style={styles.clear}>清除</Text>
          </PressScale>
        ) : null}
      </View>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={saved ? maskKey(saved) : '尚未設定'}
        placeholderTextColor={theme.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      <ActionButton
        variant="secondary"
        label="儲存"
        busyLabel="儲存中…"
        disabled={text.trim() === ''}
        onPress={save}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingTop: 12, paddingBottom: 40, gap: 14 },
  card: {
    gap: 12,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: theme.text, fontSize: 15, fontWeight: '600' },
  clear: { color: theme.textMuted, fontSize: 13 },
  input: {
    color: theme.text,
    fontSize: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
});
