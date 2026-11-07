/**
 * Everything that sets the app up or looks after its data: the theme, the flight
 * API key, the cloud backup, exports, and redrawing the fog.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  backUpNow,
  connect,
  disconnect,
  loadCloudStatus,
  restoreFromCloud,
  type CloudStatus,
} from '../cloud/cloudBackup';
import { discardExport, exportGpx, exportSnapshot, share, type ExportResult } from '../export/backup';
import { folderLabel, type ExportMode, type ExportSettings, DEFAULT_EXPORT_SETTINGS } from '../export/exportSettings';
import { createFolderPort } from '../export/folderPort';
import { saveToFolder } from '../export/saveToFolder';
import { loadExportSettings, saveExportSettings } from '../export/settingsFile';
import { API_KEYS, maskKey, saveApiKey, type ApiKeyName } from '../settings/apiKeys';
import { apiKey, expoKeyStore } from '../settings/expoKeyStore';
import { database } from '../store/database';
import { rebuildFog } from '../store/rebuild';
import { buildSummary } from '../store/summary';
import { ActionButton } from './ActionButton';
import type { ActionResult } from './actionState';
import { ask } from './dialog';
import { formatArea } from './format';
import { Icon } from './Icon';
import { PressScale } from './PressScale';
import { useStyles, useTheme, useThemeChooser } from './ThemeProvider';
import { radius, THEMES, THEME_IDS, TOOLBAR_CLEARANCE, type Theme } from './themes';
import { Text, TextInput } from './Text';

type Busy = 'gpx' | 'snapshot' | 'connect' | 'upload' | 'restore' | 'rebuild' | null;

export const SettingsScreen = memo(function SettingsScreen() {
  const styles = useStyles(make);
  const [busy, setBusy] = useState<Busy>(null);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);

  useEffect(() => {
    void loadExportSettings().then(setExportSettings);
  }, []);

  const changeExportSettings = useCallback((next: ExportSettings) => {
    setExportSettings(next);
    void saveExportSettings(next).catch(() => {
      // Not being able to remember a choice must not get in the way of making it.
    });
  }, []);

  const refresh = useCallback(async () => {
    setCloud(await loadCloudStatus(await database()));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Runs an action, keeping one place responsible for what happens when it
   * fails. What it says on success goes back to the button that was tapped,
   * which shows it there; `busy` only keeps the other buttons from starting
   * something at the same time.
   */
  async function run(
    kind: Exclude<Busy, null>,
    action: () => Promise<string | null>,
  ): Promise<ActionResult> {
    setBusy(kind);
    try {
      return { ok: true, message: await action() };
    } catch (error) {
      await ask({
        title: '操作失敗',
        message: error instanceof Error ? error.message : String(error),
        confirmLabel: '好',
      });
      return { ok: false };
    } finally {
      setBusy(null);
    }
  }

  const askToRestore = () =>
    ask({
      title: '從雲端還原',
      message:
        '這會用雲端上的備份覆蓋這台裝置目前的所有記錄。還原後必須手動重新啟動 App。\n\n' +
        '目前的資料會先複製到快取保留一份，但那不是長久的保存位置。',
      confirmLabel: '確定還原',
      cancelLabel: '取消',
      destructive: true,
    });

  const restore = () =>
    run('restore', async () => {
      await restoreFromCloud(await database());
      await ask({
        title: '還原完成',
        message: '請完全關閉 App 再重新開啟，資料才會生效。',
        confirmLabel: '好',
      });
      await refresh();
      return null;
    });

  /**
   * Put a finished export where the user wants it: handed to the share sheet, or
   * saved into the folder they chose. What it returns is what the button says.
   */
  async function deliver(result: ExportResult): Promise<string | null> {
    if (exportSettings.mode === 'share') {
      await share(result);
      return `${result.fileName} · ${formatBytes(result.bytes)}`;
    }

    // The copy in the cache is only a stop on the way: whatever happens, it goes.
    try {
      const saved = await saveToFolder(
        createFolderPort(() =>
          ask({
            title: '選擇存放位置',
            message: '選「下載」裡的一個資料夾，之後都存到那裡。',
            confirmLabel: '選擇資料夾',
            cancelLabel: '取消',
          }),
        ),
        exportSettings.folderUri,
        result,
      );

      if (!saved.saved) return null;

      if (saved.folderUri !== exportSettings.folderUri) {
        changeExportSettings({ ...exportSettings, folderUri: saved.folderUri });
      }

      return `已存到 ${folderLabel(saved.folderUri)} · ${formatBytes(result.bytes)}`;
    } finally {
      discardExport(result);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>設定</Text>

      <ThemeAndKeys />

      <Text style={styles.heading}>雲端備份</Text>
      <CloudGroup
        status={cloud}
        busy={busy}
        onConnect={() =>
          run('connect', async () => {
            const account = await connect();
            await refresh();
            return account === null ? null : `已連結 ${account.email}`;
          })
        }
        onDisconnect={() =>
          void run('connect', async () => {
            await disconnect();
            await refresh();
            return null;
          })
        }
        onBackUp={() =>
          run('upload', async () => {
            const remote = await backUpNow(await database());
            await refresh();
            return `已上傳 · ${formatBytes(remote.bytes)}`;
          })
        }
        askToRestore={askToRestore}
        onRestore={restore}
      />

      <Text style={styles.heading}>匯出</Text>
      <View style={styles.group}>
        <ActionButton
          variant="row"
          label="匯出軌跡（GPX）"
          busyLabel="匯出中…"
          disabled={busy !== null}
          onPress={() => run('gpx', async () => deliver(await exportGpx(await database())))}
        />
        <View style={styles.line} />
        <ActionButton
          variant="row"
          label="匯出完整備份"
          busyLabel="打包中…"
          disabled={busy !== null}
          onPress={() => run('snapshot', async () => deliver(await exportSnapshot(await database())))}
        />
        <View style={styles.line} />
        <ModeSwitch
          mode={exportSettings.mode}
          onChange={(mode) => changeExportSettings({ ...exportSettings, mode })}
        />
      </View>

      <Text style={styles.heading}>迷霧</Text>
      <View style={styles.group}>
        <ActionButton
          variant="row"
          label="重畫歷史迷霧"
          busyLabel="重畫中…"
          disabled={busy !== null}
          onPress={() =>
            run('rebuild', async () => {
              const driver = await database();
              const before = (await buildSummary(driver)).exploredSquareMeters;
              const result = await rebuildFog(driver);
              const after = (await buildSummary(driver)).exploredSquareMeters;
              // The area is read back from the summary rather than derived from
              // the cell count: a cell's size depends on its latitude, so any
              // single conversion factor here would be wrong somewhere.
              return result.cellsAdded === 0
                ? `檢查了 ${result.pointsRead} 筆定位，沒有可補的範圍`
                : `補上 ${formatArea(after - before)}，涵蓋 ${result.tilesTouched} 個磚格`;
            })
          }
        />
      </View>
    </ScrollView>
  );
});

function ThemeAndKeys() {
  const styles = useStyles(make);
  const t = useTheme();
  const choose = useThemeChooser();
  // Where the menu hangs from on the screen; null while it is shut.
  const [menuTop, setMenuTop] = useState<number | null>(null);
  const row = useRef<View>(null);

  const close = () => setMenuTop(null);

  return (
    <View style={styles.group}>
      <View ref={row} collapsable={false}>
        <PressScale
          style={styles.row}
          onPress={() =>
            row.current?.measureInWindow((_x, y, _width, height) => setMenuTop(y + height))
          }
        >
          <Text style={styles.rowText}>主題</Text>
          <View style={styles.rowEnd}>
            <Swatch theme={t} />
            <Text style={styles.rowValue}>{t.name}</Text>
            <Icon name="chevronDown" color={t.ink} size={20} />
          </View>
        </PressScale>
      </View>

      {API_KEYS.map(({ name, label }) => (
        <KeyRow key={name} name={name} label={label} />
      ))}

      {/* A Modal so that a tap anywhere else shuts it. Hung inside the page it
          would also stick out of its parent, where touches depend on the
          overflow rules of every view above it. */}
      <Modal
        visible={menuTop !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={close}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="關閉" />
        <View style={[styles.menu, { top: menuTop ?? 0 }]}>
          {THEME_IDS.map((id) => {
            const option = THEMES[id];
            return (
              <PressScale
                key={id}
                style={[styles.menuRow, id === t.id && styles.menuRowOn]}
                onPress={() => {
                  choose(id);
                  close();
                }}
              >
                <Swatch theme={option} />
                <Text style={styles.menuText}>{option.name}</Text>
                {id === t.id ? <Icon name="check" color={t.ink} size={20} weight={2.6} /> : null}
              </PressScale>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

function Swatch({ theme }: { theme: Theme }) {
  const styles = useStyles(make);
  return (
    <View style={styles.swatch}>
      <View style={[styles.swatchDot, { backgroundColor: theme.tile }]} />
      <View style={[styles.swatchDot, styles.swatchSecond, { backgroundColor: theme.accent }]} />
    </View>
  );
}

function KeyRow({ name, label }: { name: ApiKeyName; label: string }) {
  const styles = useStyles(make);
  const t = useTheme();
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);

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
      setEditing(false);
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
    <>
      <View style={styles.line} />
      <PressScale style={styles.row} onPress={() => setEditing((v) => !v)}>
        <Text style={styles.rowText}>{label}</Text>
        <View style={styles.rowEnd}>
          <Text style={styles.rowMuted}>{saved ? maskKey(saved) : '尚未設定'}</Text>
          <Icon name="chevronRight" color={t.muted} size={18} />
        </View>
      </PressScale>
      {editing ? (
        <View style={styles.keyEditor}>
          <TextInput
            style={styles.keyInput}
            value={text}
            onChangeText={setText}
            placeholder="貼上金鑰"
            placeholderTextColor={t.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <ActionButton
            variant="primary"
            label="儲存"
            busyLabel="儲存中…"
            disabled={text.trim() === ''}
            onPress={save}
          />
          {saved ? (
            <PressScale onPress={() => void clear()} hitSlop={8}>
              <Text style={styles.clear}>清除金鑰</Text>
            </PressScale>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function CloudGroup({
  status,
  busy,
  onConnect,
  onDisconnect,
  onBackUp,
  askToRestore,
  onRestore,
}: {
  status: CloudStatus | null;
  busy: Busy;
  onConnect: () => Promise<ActionResult>;
  onDisconnect: () => void;
  onBackUp: () => Promise<ActionResult>;
  askToRestore: () => Promise<boolean>;
  onRestore: () => Promise<ActionResult>;
}) {
  const styles = useStyles(make);
  const t = useTheme();

  if (status === null) {
    return (
      <View style={[styles.group, styles.cloudLoading]}>
        <ActivityIndicator color={t.muted} />
      </View>
    );
  }

  if (!status.configured) {
    return (
      <View style={styles.group}>
        <View style={styles.row}>
          <Text style={styles.rowText}>Google 雲端硬碟</Text>
          <Text style={styles.rowMuted}>尚未設定</Text>
        </View>
      </View>
    );
  }

  if (status.account === null) {
    return (
      <View style={styles.group}>
        <ActionButton
          variant="row"
          label="連結 Google 帳號"
          busyLabel="連結中…"
          disabled={busy !== null}
          onPress={onConnect}
        />
      </View>
    );
  }

  return (
    <View style={styles.group}>
      <View style={styles.cloudAccount}>
        <Text style={styles.rowText} numberOfLines={1}>
          {status.account.email}
        </Text>
        <Text style={styles.rowMuted}>
          {status.remote
            ? `雲端備份 ${formatBytes(status.remote.bytes)} · ${formatWhen(status.remote.modifiedAt)}`
            : status.lastBackupAt
              ? '雲端上找不到備份檔'
              : '尚未備份過'}
        </Text>
      </View>
      <View style={styles.line} />
      <ActionButton
        variant="row"
        label="立即備份"
        busyLabel="備份中…"
        disabled={busy !== null}
        onPress={onBackUp}
      />
      <View style={styles.line} />
      <ActionButton
        variant="row"
        label="從雲端還原"
        busyLabel="還原中…"
        disabled={busy !== null || status.remote === null}
        confirm={askToRestore}
        onPress={onRestore}
      />
      <View style={styles.line} />
      <PressScale style={styles.row} onPress={onDisconnect} disabled={busy !== null}>
        <Text style={styles.rowText}>中斷連結</Text>
      </PressScale>
    </View>
  );
}

function ModeSwitch({ mode, onChange }: { mode: ExportMode; onChange: (mode: ExportMode) => void }) {
  const styles = useStyles(make);
  const choices: Array<{ mode: ExportMode; label: string }> = [
    { mode: 'share', label: '分享' },
    { mode: 'save', label: '存到手機' },
  ];

  return (
    <View style={styles.row}>
      <Text style={styles.rowText}>匯出到</Text>
      <View style={styles.modes}>
        {choices.map((choice) => (
          <PressScale
            key={choice.mode}
            style={[styles.mode, mode === choice.mode && styles.modeOn]}
            onPress={() => onChange(choice.mode)}
          >
            <Text style={[styles.modeText, mode === choice.mode && styles.modeTextOn]}>
              {choice.label}
            </Text>
          </PressScale>
        ))}
      </View>
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const make = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: TOOLBAR_CLEARANCE + 16, gap: 8 },
    title: { color: t.ink, fontSize: 34, fontWeight: '900', paddingHorizontal: 6, marginBottom: 6 },
    heading: { color: t.muted, fontSize: 14, paddingHorizontal: 8, marginTop: 8 },
    group: { borderRadius: radius.group, backgroundColor: t.soft, overflow: 'hidden' },
    line: { height: 1, backgroundColor: t.ground },
    row: {
      minHeight: 50,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    rowText: { color: t.ink, fontSize: 15, flexShrink: 1 },
    rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowValue: { color: t.ink, fontSize: 15, fontWeight: '700' },
    rowMuted: { color: t.muted, fontSize: 14 },

    menu: {
      position: 'absolute',
      right: 16,
      width: 196,
      padding: 6,
      gap: 2,
      borderRadius: 20,
      backgroundColor: '#FFFFFF',
      elevation: 8,
    },
    menuRow: {
      height: 48,
      paddingHorizontal: 12,
      borderRadius: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    menuRowOn: { backgroundColor: t.soft },
    menuText: { flex: 1, color: t.ink, fontSize: 15 },
    swatch: { flexDirection: 'row' },
    swatchDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#FFFFFF' },
    swatchSecond: { marginLeft: -8 },

    keyEditor: { padding: 12, gap: 10, alignItems: 'stretch' },
    keyInput: {
      height: 48,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: t.ground,
      color: t.ink,
      fontSize: 15,
    },
    clear: { color: t.muted, fontSize: 14, textAlign: 'center', paddingVertical: 6 },

    cloudLoading: { height: 50, alignItems: 'center', justifyContent: 'center' },
    cloudAccount: { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },

    modes: { flexDirection: 'row', padding: 3, borderRadius: 16, backgroundColor: t.ground },
    mode: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 13 },
    modeOn: { backgroundColor: t.ink },
    modeText: { color: t.ink, fontSize: 13 },
    modeTextOn: { color: '#FFFFFF', fontWeight: '700' },
  });
