import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { database } from '../store/database';
import { rebuildFog } from '../store/rebuild';
import { buildSummary } from '../store/summary';
import { ActionButton } from './ActionButton';
import { FadeIn } from './FadeIn';
import { CURVE, DURATION, staggerDelay } from './motion';
import { PressScale } from './PressScale';
import type { ActionResult } from './actionState';
import { formatArea } from './format';
import { ask } from './dialog';
import { radius, theme } from './theme';
import { useReducedMotion } from './useReducedMotion';

type Busy = 'gpx' | 'snapshot' | 'connect' | 'upload' | 'restore' | 'status' | 'rebuild' | null;

export const BackupScreen = memo(function BackupScreen({
  hideTitle = false,
}: {
  hideTitle?: boolean;
} = {}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [exportsOpen, setExportsOpen] = useState(false);
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
            message: '選「下載」裡的資料夾，可以按「新增資料夾」建立一個，例如 WorldTrace。之後都會存到那裡。',
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
      contentContainerStyle={[styles.content, hideTitle && styles.contentCompact]}
    >
      {!hideTitle ? <Text style={styles.title}>備份</Text> : null}

      <Text style={styles.sectionLabel}>Google 雲端硬碟</Text>
      <CloudPanel
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

      <Text style={styles.sectionLabel}>迷霧</Text>

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

      {/* Folded away by default. The cloud backup is the answer for almost
          everyone almost always; these are the escape hatch for the day
          Google is the thing that broke. */}
      <DisclosureRow open={exportsOpen} onToggle={() => setExportsOpen((open) => !open)} />

      {exportsOpen ? (
        <>
          <FadeIn offset={-6} delay={staggerDelay(0)}>
            <ModeSwitch
              mode={exportSettings.mode}
              onChange={(mode) => changeExportSettings({ ...exportSettings, mode })}
            />
          </FadeIn>

          <FadeIn offset={-6} delay={staggerDelay(1)}>
            <ActionButton
              variant="row"
              label="匯出軌跡（GPX）"
              busyLabel="匯出中…"
              disabled={busy !== null}
              onPress={() =>
                run('gpx', async () => {
                  return deliver(await exportGpx(await database()));
                })
              }
            />
          </FadeIn>

          <FadeIn offset={-6} delay={staggerDelay(2)}>
            <ActionButton
              variant="row"
              label="匯出完整備份"
              busyLabel="打包中…"
              disabled={busy !== null}
              onPress={() =>
                run('snapshot', async () => {
                  return deliver(await exportSnapshot(await database()));
                })
              }
            />
          </FadeIn>
        </>
      ) : null}
    </ScrollView>
  );
});

function DisclosureRow({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const reduced = useReducedMotion();
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    const toValue = open ? 1 : 0;
    if (reduced) {
      turn.setValue(toValue);
      return;
    }

    const animation = Animated.timing(turn, {
      toValue,
      duration: DURATION.enter,
      easing: Easing.bezier(...CURVE.enter),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [open, reduced, turn]);

  const rotate = turn.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <PressScale style={styles.disclosure} onPress={onToggle} hitSlop={4}>
      <Text style={styles.disclosureText}>其他匯出</Text>
      <Animated.Text style={[styles.disclosureChevron, { transform: [{ rotate }] }]}>
        ⌄
      </Animated.Text>
    </PressScale>
  );
}

function CloudPanel({
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
  if (status === null) {
    return (
      <View style={styles.cloud}>
        <ActivityIndicator color={theme.textFaint} />
      </View>
    );
  }

  if (!status.configured) {
    return (
      <View style={styles.cloud}>
        <Text style={styles.cloudTitle}>尚未設定</Text>
      </View>
    );
  }

  if (status.account === null) {
    return (
      <View style={styles.cloud}>
        <Text style={styles.cloudTitle}>尚未連結</Text>
        <ActionButton
          variant="primary"
          label="連結 Google 帳號"
          busyLabel="連結中…"
          disabled={busy !== null}
          onPress={onConnect}
        />
      </View>
    );
  }

  return (
    <View style={styles.cloud}>
      <View style={styles.cloudHead}>
        <View style={styles.cloudDot} />
        <Text style={styles.cloudEmail} numberOfLines={1}>
          {status.account.email}
        </Text>
      </View>

      <Text style={styles.cloudBody}>
        {status.remote
          ? `雲端備份 ${formatBytes(status.remote.bytes)} · ${formatWhen(status.remote.modifiedAt)}`
          : status.lastBackupAt
            ? '雲端上找不到備份檔（可能已被刪除）'
            : '尚未備份過'}
      </Text>

      <View style={styles.cloudActions}>
        <ActionButton
          variant="primary"
          label="立即備份"
          busyLabel="備份中…"
          disabled={busy !== null}
          onPress={onBackUp}
        />
        <ActionButton
          variant="secondary"
          label="從雲端還原"
          busyLabel="還原中…"
          disabled={busy !== null || status.remote === null}
          confirm={askToRestore}
          onPress={onRestore}
        />
      </View>

      <PressScale
        onPress={onDisconnect}
        disabled={busy !== null}
        hitSlop={8}
        containerStyle={styles.unlinkWrap}
      >
        <Text style={styles.unlink}>中斷連結</Text>
      </PressScale>
    </View>
  );
}

function ModeSwitch({ mode, onChange }: { mode: ExportMode; onChange: (mode: ExportMode) => void }) {
  const choices: Array<{ mode: ExportMode; label: string }> = [
    { mode: 'share', label: '分享' },
    { mode: 'save', label: '存到手機' },
  ];

  return (
    <View style={styles.modeSwitch}>
      {choices.map((choice) => (
        <PressScale
          key={choice.mode}
          containerStyle={styles.modeSegmentSlot}
          style={[styles.modeSegment, mode === choice.mode && styles.modeSegmentOn]}
          onPress={() => onChange(choice.mode)}
        >
          <Text style={[styles.modeText, mode === choice.mode && styles.modeTextOn]}>{choice.label}</Text>
        </PressScale>
      ))}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingTop: 64, paddingBottom: 40, gap: 12 },
  contentCompact: { paddingTop: 12 },
  title: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sectionLabel: {
    color: theme.textFaint,
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: -4,
  },

  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginTop: 4,
  },
  disclosureText: { color: theme.textFaint, fontSize: 11, letterSpacing: 1 },
  disclosureChevron: { color: theme.textFaint, fontSize: 13 },

  modeSwitch: {
    flexDirection: 'row',
    gap: 8,
  },
  modeSegmentSlot: { flexGrow: 1, flexBasis: 0 },
  modeSegment: {
    paddingVertical: 9,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
  },
  modeSegmentOn: { backgroundColor: theme.surfaceSolid, borderColor: theme.accent },
  modeText: { color: theme.textFaint, fontSize: 12, fontWeight: '600' },
  modeTextOn: { color: theme.text },

  cloud: {
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    gap: 10,
  },
  cloudHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cloudDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.live },
  cloudEmail: { color: theme.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  cloudTitle: { color: theme.text, fontSize: 15, fontWeight: '600' },
  cloudBody: { color: theme.textFaint, fontSize: 11, lineHeight: 17 },
  cloudActions: { flexDirection: 'row', gap: 10 },
  unlinkWrap: { alignSelf: 'flex-start' },
  unlink: { color: theme.textFaint, fontSize: 11, textDecorationLine: 'underline' },
});
