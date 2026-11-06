/**
 * A button that answers for what it does, in place.
 *
 * Tap it and it presses; while the work runs it shows a spinner; when the work
 * is done the label itself becomes what happened ("已上傳 · 3.2 MB") for a
 * moment and then goes back. The answer is on the thing that was touched, not
 * in a corner of the screen the eye has to go and find.
 *
 * What the button shows when is decided in actionState.ts, which is tested; this
 * file only draws it.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { buttonLabel, createActionState, runAction, type ActionResult } from './actionState';
import { FadeIn } from './FadeIn';
import { PressScale } from './PressScale';
import { SwapText } from './SwapText';
import { radius, theme } from './theme';

type Variant = 'primary' | 'secondary' | 'row';

export function ActionButton({
  variant,
  label,
  busyLabel,
  disabled = false,
  confirm,
  onPress,
}: {
  variant: Variant;
  label: string;
  /** Shown while the work runs, so the text itself answers before completion. */
  busyLabel?: string;
  /** True while something else is running: this button waits its turn. */
  disabled?: boolean;
  /** Asked before anything starts. No means the tap never happened. */
  confirm?: () => Promise<boolean>;
  onPress: () => Promise<ActionResult>;
}) {
  const state = useMemo(() => createActionState(), []);
  useEffect(() => () => state.dispose(), [state]);

  const phase = useSyncExternalStore(state.subscribe, state.phase);
  const busy = phase.kind === 'busy';
  const done = phase.kind === 'done';

  const tap = () => {
    // An error has already been reported by whoever did the work; the button's
    // part was to stop spinning, which runAction has seen to.
    void runAction(state, onPress, confirm).catch(() => {});
  };

  const faded = disabled && phase.kind === 'idle';

  // A row already ends in a tick when it is done; the others carry theirs in
  // the text, since they have no other place for one.
  const shown = buttonLabel(phase, {
    label,
    busyLabel,
    tickInText: variant !== 'row',
  });

  if (variant === 'row') {
    return (
      <PressScale
        style={[styles.row, faded && styles.faded]}
        disabled={disabled || busy}
        onPress={tap}
      >
        <SwapText
          text={shown}
          style={[styles.rowTitle, done && styles.confirmed]}
          numberOfLines={1}
          ellipsizeMode="middle"
        />
        <View style={styles.rowEnd}>
          {busy ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <SwapText text={done ? '✓' : '›'} style={[styles.rowArrow, done && styles.confirmed]} />
          )}
        </View>
      </PressScale>
    );
  }

  const primary = variant === 'primary';

  return (
    <PressScale
      containerStyle={styles.grow}
      style={[primary ? styles.primary : styles.secondary, faded && styles.faded]}
      disabled={disabled || busy}
      onPress={tap}
    >
      {busy ? (
        <FadeIn offset={0} style={styles.spinner}>
          <ActivityIndicator size="small" color={primary ? PRIMARY_INK : theme.accent} />
        </FadeIn>
      ) : null}
      <SwapText
        text={shown}
        style={[
          primary ? styles.primaryText : styles.secondaryText,
          done && !primary && styles.confirmed,
        ]}
        numberOfLines={1}
        ellipsizeMode="middle"
      />
    </PressScale>
  );
}

const PRIMARY_INK = '#04101f';

const styles = StyleSheet.create({
  grow: { flexGrow: 1, flexBasis: 0 },
  faded: { opacity: 0.45 },
  confirmed: { color: theme.live },

  primary: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: radius.card,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: PRIMARY_INK, fontSize: 13, fontWeight: '700' },
  secondary: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },

  // Beside the label rather than in line with it, so the label does not shift
  // sideways when the spinner appears while SwapText flips to busyLabel.
  spinner: {
    position: 'absolute',
    left: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  rowTitle: { color: theme.text, fontSize: 15, fontWeight: '600', flexShrink: 1, paddingRight: 12 },
  rowEnd: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  rowArrow: { color: theme.accent, fontSize: 18 },
});
