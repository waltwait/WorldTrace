/**
 * Full-screen preview and export sheet for the two shareable cards:
 * - `{ kind: 'trip', trip }` from TripScreen's top-right button
 * - `{ kind: 'year', flights, year }` from PassportScreen's top-right button
 *
 * Previews the real card view scaled to fit the stage and captures the unscaled
 * inner `cardRef` directly to a 1080×1920 (9:16) or 1080×1350 (4:5) PNG.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { exportCapturedImage } from '../export/expoDeliverImage';
import type { ExportMode } from '../export/exportSettings';
import {
  CARD_DIMENSIONS,
  buildTripShareModel,
  buildYearShareModel,
  type CardAspect,
} from '../flights/shareCard';
import type { PassportTrip } from '../flights/trips';
import type { FlightRecord } from '../flights/types';
import { ActionButton } from './ActionButton';
import type { ActionResult } from './actionState';
import { ask } from './dialog';
import { FullScreenModal } from './FullScreenModal';
import { useHomeCountry } from './HomeCountry';
import { PressScale } from './PressScale';
import { ShareCardsBody } from './ShareCardStage';
import { SheetHeader } from './SheetHeader';
import { Text } from './Text';
import { useStyles } from './ThemeProvider';
import { FONT, radius, type Theme } from './themes';

export type ShareCardTarget =
  | { kind: 'trip'; trip: PassportTrip }
  | { kind: 'year'; flights: readonly FlightRecord[]; year: string | null };

const ASPECT_OPTIONS: ReadonlyArray<{ value: CardAspect; label: string }> = [
  { value: '9:16', label: '9:16 限動' },
  { value: '4:5', label: '4:5 貼文' },
];

export function ShareCardSheet({
  target,
  visible,
  onClose,
}: {
  target: ShareCardTarget | null;
  visible: boolean;
  onClose: () => void;
}) {
  const styles = useStyles(make);
  const { home } = useHomeCountry();
  const [aspect, setAspect] = useState<CardAspect>('9:16');
  const [busy, setBusy] = useState<ExportMode | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const cardRef = useRef<View>(null);

  useEffect(() => {
    if (!visible) return;
    setAspect('9:16');
  }, [visible]);

  const rendered = useMemo(() => {
    if (!target) return null;
    if (target.kind === 'trip') {
      const model = buildTripShareModel(target.trip, aspect, home);
      return { kind: 'trip' as const, model, fileName: model.fileName };
    }
    const model = buildYearShareModel(target.flights, home, target.year, aspect);
    return { kind: 'year' as const, model, fileName: model.fileName };
  }, [aspect, home, target]);

  const onStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStage((prev) =>
      Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
        ? prev
        : { width, height },
    );
  }, []);

  const dim = CARD_DIMENSIONS[aspect];
  const scale =
    stage.width > 0 && stage.height > 0
      ? Math.min((stage.width - 32) / dim.logicalWidth, (stage.height - 28) / dim.logicalHeight, 1)
      : 0.72;

  const run = useCallback(
    async (mode: ExportMode): Promise<ActionResult> => {
      if (!rendered) return { ok: false };
      setBusy(mode);
      try {
        const message = await exportCapturedImage(
          async () => {
            if (!cardRef.current) throw new Error('畫面尚未準備好，請再試一次');
            return captureRef(cardRef, {
              format: 'png',
              quality: 1,
              result: 'tmpfile',
              width: dim.pixelWidth,
              height: dim.pixelHeight,
            });
          },
          () =>
            ask({
              title: '選擇存放位置',
              message: '選「下載」裡的一個資料夾，之後都存到那裡。',
              confirmLabel: '選擇資料夾',
              cancelLabel: '取消',
            }),
          mode,
          rendered.fileName,
        );
        return { ok: true, message };
      } catch (error) {
        await ask({
          title: '匯出失敗',
          message: error instanceof Error ? error.message : String(error),
          confirmLabel: '好',
        });
        return { ok: false };
      } finally {
        setBusy(null);
      }
    },
    [dim.pixelHeight, dim.pixelWidth, rendered],
  );

  return (
    <FullScreenModal visible={visible && rendered !== null} onRequestClose={onClose}>
      <View style={styles.screen}>
        <SheetHeader title="匯出圖片" onClose={onClose} />

        <View style={styles.switcherWrap}>
          <View style={styles.switcher}>
            {ASPECT_OPTIONS.map((option) => {
              const active = option.value === aspect;
              return (
                <PressScale
                  key={option.value}
                  style={[styles.tab, active && styles.tabActive]}
                  disabled={busy !== null}
                  onPress={() => setAspect(option.value)}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>
                    {option.label}
                  </Text>
                </PressScale>
              );
            })}
          </View>
        </View>

        <View style={styles.stage} onLayout={onStageLayout}>
          {rendered ? (
            <ShareCardsBody
              cardRef={cardRef}
              rendered={rendered}
              scale={scale}
              width={dim.logicalWidth}
              height={dim.logicalHeight}
            />
          ) : null}
        </View>

        <View style={styles.actions}>
          <View style={styles.actionSlot}>
            <ActionButton
              variant="secondary"
              label="存到手機"
              busyLabel="儲存中..."
              disabled={busy !== null}
              onPress={() => run('save')}
            />
          </View>
          <View style={styles.actionSlot}>
            <ActionButton
              variant="primary"
              label="分享"
              busyLabel="準備中..."
              disabled={busy !== null}
              onPress={() => run('share')}
            />
          </View>
        </View>
      </View>
    </FullScreenModal>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.ground,
      paddingBottom: 24,
      gap: 12,
    },
    switcherWrap: {
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    switcher: {
      flexDirection: 'row',
      padding: 4,
      borderRadius: radius.round,
      backgroundColor: t.soft,
      gap: 2,
    },
    tab: {
      height: 36,
      paddingHorizontal: 18,
      borderRadius: radius.round,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabActive: {
      backgroundColor: t.ink,
    },
    tabText: {
      color: t.ink,
      fontFamily: FONT.bold,
      fontSize: 13.5,
    },
    tabTextActive: {
      color: '#FFFFFF',
    },
    stage: {
      flex: 1,
      marginHorizontal: 16,
      borderRadius: 26,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    actions: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      gap: 10,
    },
    actionSlot: {
      flex: 1,
    },
  });
