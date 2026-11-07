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
import { useStyles, useTheme } from './ThemeProvider';
import { radius, type Theme } from './themes';

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
  const styles = useStyles(make);
  const t = useTheme();
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
            <ActivityIndicator size="small" color={t.muted} />
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
          <ActivityIndicator size="small" color={primary ? '#FFFFFF' : t.ink} />
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

const make = (t: Theme) =>
  StyleSheet.create({
    grow: { flexGrow: 1, flexBasis: 0 },
    faded: { opacity: 0.45 },
    confirmed: { color: t.ink, fontWeight: '700' },

    primary: {
      height: 52,
      paddingHorizontal: 18,
      borderRadius: radius.round,
      backgroundColor: t.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
    secondary: {
      height: 52,
      paddingHorizontal: 18,
      borderRadius: radius.round,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: { color: t.ink, fontSize: 15, fontWeight: '700' },

    // Beside the label rather than in line with it, so the label does not shift
    // sideways when the spinner appears while SwapText flips to busyLabel.
    spinner: {
      position: 'absolute',
      left: 16,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
    },

    // A line in a group of settings, drawn on the group's own background.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 50,
      paddingHorizontal: 16,
    },
    rowTitle: { color: t.ink, fontSize: 15, flexShrink: 1, paddingRight: 12 },
    rowEnd: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
    rowArrow: { color: t.muted, fontSize: 18 },
  });
