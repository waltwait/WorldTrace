import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  backUpNow,
  connect,
  disconnect,
  loadCloudStatus,
  restoreFromCloud,
  type CloudStatus,
} from '../cloud/cloudBackup';
import { exportGpx, exportSnapshot, share } from '../export/backup';
import { database } from '../store/database';
import { rebuildFog } from '../store/rebuild';
import { buildSummary } from '../store/summary';
import { formatArea } from './format';
import { ask } from './dialog';
import { radius, theme } from './theme';

type Busy = 'gpx' | 'snapshot' | 'connect' | 'upload' | 'restore' | 'status' | 'rebuild' | null;

export function BackupScreen() {
  const [busy, setBusy] = useState<Busy>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [exportsOpen, setExportsOpen] = useState(false);

  const refresh = useCallback(async () => {
    setCloud(await loadCloudStatus(await database()));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs an action, keeping one place responsible for spinners and errors. */
  async function run(kind: Exclude<Busy, null>, action: () => Promise<string | null>) {
    setBusy(kind);
    try {
      const message = await action();
      if (message !== null) setLastResult(message);
    } catch (error) {
      await ask({
        title: '操作失敗',
        message: error instanceof Error ? error.message : String(error),
        confirmLabel: '好',
      });
    } finally {
      setBusy(null);
    }
  }

  async function confirmRestore() {
    const confirmed = await ask({
      title: '從雲端還原',
      message:
        '這會用雲端上的備份覆蓋這台裝置目前的所有記錄。還原後必須手動重新啟動 App。\n\n' +
        '目前的資料會先複製到快取保留一份，但那不是長久的保存位置。',
      confirmLabel: '確定還原',
      cancelLabel: '取消',
      destructive: true,
    });

    if (!confirmed) return;

    await run('restore', async () => {
      await restoreFromCloud(await database());
      await ask({
        title: '還原完成',
        message: '請完全關閉 App 再重新開啟，資料才會生效。',
        confirmLabel: '好',
      });
      await refresh();
      return null;
    });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>備份</Text>

      <Text style={styles.sectionLabel}>Google 雲端硬碟</Text>
      <CloudPanel
        status={cloud}
        busy={busy}
        onConnect={() =>
          void run('connect', async () => {
            const account = await connect();
            await refresh();
            return account === null ? null : `已連結 ${account.email}`;
          })
        }
        onDisconnect={() =>
          void run('connect', async () => {
            await disconnect();
            await refresh();
            return '已中斷連結，雲端上的備份仍保留';
          })
        }
        onBackUp={() =>
          void run('upload', async () => {
            const remote = await backUpNow(await database());
            await refresh();
            return `已上傳 · ${formatBytes(remote.bytes)}`;
          })
        }
        onRestore={() => void confirmRestore()}
      />

      <Text style={styles.sectionLabel}>迷霧</Text>

      <Action
        title="重畫歷史迷霧"
        description="用目前的規則，把過去記錄過但沒被擦開的路重新畫一次。只會補上，不會擦掉任何已開的範圍。"
        busy={busy === 'rebuild'}
        disabled={busy !== null}
        onPress={() =>
          void run('rebuild', async () => {
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
      <Pressable style={styles.disclosure} onPress={() => setExportsOpen((open) => !open)}>
        <Text style={styles.disclosureText}>其他匯出</Text>
        <Text style={styles.disclosureChevron}>{exportsOpen ? '⌃' : '⌄'}</Text>
      </Pressable>

      {exportsOpen ? (
        <>
          <Action
            title="匯出軌跡（GPX）"
            description="給其他地圖軟體讀的標準格式。不含迷霧資料。"
            busy={busy === 'gpx'}
            disabled={busy !== null}
            onPress={() =>
              void run('gpx', async () => {
                const result = await exportGpx(await database());
                await share(result);
                return `${result.fileName} · ${formatBytes(result.bytes)}`;
              })
            }
          />

          <Action
            title="匯出完整備份"
            description="與雲端備份同一份檔案，改存到你自己選的地方。Google 帳號出事時的退路。"
            busy={busy === 'snapshot'}
            disabled={busy !== null}
            onPress={() =>
              void run('snapshot', async () => {
                const result = await exportSnapshot(await database());
                await share(result);
                return `${result.fileName} · ${formatBytes(result.bytes)}`;
              })
            }
          />
        </>
      ) : null}

      {lastResult ? <Text style={styles.result}>{lastResult}</Text> : null}

      <View style={styles.note}>
        <Text style={styles.noteTitle}>備份了什麼</Text>
        <Text style={styles.noteBody}>
          整個資料庫：每一筆通過驗證的定位、每一趟記錄的起訖，以及擦開的迷霧點陣圖 ——
          最後這項是走不回來的，也是備份真正在保的東西。
        </Text>
      </View>

      <View style={styles.note}>
        <Text style={styles.noteTitle}>雲端備份存在哪裡</Text>
        <Text style={styles.noteBody}>
          存在你自己的 Google 雲端硬碟裡一個隱藏的應用程式資料夾。你在雲端硬碟的檔案列表中看不到它，
          其他 App 也讀不到。WorldTrace 取得的權限只到這個資料夾為止 —— 它看不到你雲端硬碟裡的任何其他東西。
        </Text>
      </View>

      <View style={styles.note}>
        <Text style={styles.noteTitle}>為什麼不支援匯入 GPX</Text>
        <Text style={styles.noteBody}>
          WorldTrace 只記錄你真實抵達過的地方。一個檔案無法證明你去過哪裡，所以匯入是刻意不做的。
          從雲端還原是另一回事 —— 那是你自己記錄的原樣搬回來。
        </Text>
      </View>
    </ScrollView>
  );
}

function CloudPanel({
  status,
  busy,
  onConnect,
  onDisconnect,
  onBackUp,
  onRestore,
}: {
  status: CloudStatus | null;
  busy: Busy;
  onConnect: () => void;
  onDisconnect: () => void;
  onBackUp: () => void;
  onRestore: () => void;
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
        <Text style={styles.cloudBody}>
          這個版本還沒有內建 Google 用戶端 ID，所以無法登入。設定步驟在專案的
          docs/google-drive-setup.md。
        </Text>
      </View>
    );
  }

  if (status.account === null) {
    return (
      <View style={styles.cloud}>
        <Text style={styles.cloudTitle}>尚未連結</Text>
        <Text style={styles.cloudBody}>
          連結後，記錄會定期自動備份到你自己的雲端硬碟，換手機時可以直接還原。
        </Text>
        <Primary label="連結 Google 帳號" busy={busy === 'connect'} disabled={busy !== null} onPress={onConnect} />
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
        <Primary label="立即備份" busy={busy === 'upload'} disabled={busy !== null} onPress={onBackUp} />
        <Secondary
          label="從雲端還原"
          busy={busy === 'restore'}
          disabled={busy !== null || status.remote === null}
          onPress={onRestore}
        />
      </View>

      <Pressable onPress={onDisconnect} disabled={busy !== null} hitSlop={8}>
        <Text style={styles.unlink}>中斷連結</Text>
      </Pressable>
    </View>
  );
}

function Primary({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.primary, disabled && styles.faded]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.primaryText}>{busy ? '處理中…' : label}</Text>
    </Pressable>
  );
}

function Secondary({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.secondary, disabled && styles.faded]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.secondaryText}>{busy ? '處理中…' : label}</Text>
    </Pressable>
  );
}

function Action({
  title,
  description,
  busy,
  disabled,
  onPress,
}: {
  title: string;
  description: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.action, disabled && !busy && styles.faded]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.actionText}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDescription}>{description}</Text>
      </View>
      <Text style={styles.actionArrow}>{busy ? '…' : '›'}</Text>
    </Pressable>
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
  unlink: { color: theme.textFaint, fontSize: 11, textDecorationLine: 'underline' },

  primary: {
    flexGrow: 1,
    paddingVertical: 11,
    borderRadius: radius.card,
    backgroundColor: theme.accent,
    alignItems: 'center',
  },
  primaryText: { color: '#04101f', fontSize: 13, fontWeight: '700' },
  secondary: {
    flexGrow: 1,
    paddingVertical: 11,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
  },
  secondaryText: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
  faded: { opacity: 0.45 },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  actionText: { flexShrink: 1, gap: 3, paddingRight: 12 },
  actionTitle: { color: theme.text, fontSize: 15, fontWeight: '600' },
  actionDescription: { color: theme.textFaint, fontSize: 11, lineHeight: 16 },
  actionArrow: { color: theme.accent, fontSize: 18 },

  result: { color: theme.live, fontSize: 11, fontVariant: ['tabular-nums'] },

  note: {
    padding: 14,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    gap: 5,
  },
  noteTitle: { color: theme.textMuted, fontSize: 12, fontWeight: '600' },
  noteBody: { color: theme.textFaint, fontSize: 11, lineHeight: 17 },
});
