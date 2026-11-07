/**
 * How a dialog looks. Everything about how one *behaves* is in dialog.ts.
 *
 * Rendered once, near the root, and driven by the queue rather than by props —
 * so any module can ask a question without every screen in between having to
 * pass a handler down.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, StyleSheet, View } from 'react-native';
import { answer, current, subscribe, type DialogRequest } from './dialog';
import { CURVE, DURATION } from './motion';
import { PressScale } from './PressScale';
import { useStyles } from './ThemeProvider';
import { radius, SHARED, type Theme } from './themes';
import { useReducedMotion } from './useReducedMotion';
import { Text } from './Text';

export function DialogHost() {
  const styles = useStyles(make);
  const [request, setRequest] = useState<DialogRequest | null>(current);

  useEffect(() => subscribe(() => setRequest(current())), []);

  return (
    <Modal
      visible={request !== null}
      transparent
      animationType="fade"
      // Android's back gesture should behave like cancelling, not like
      // confirming — the system dialog does the same.
      onRequestClose={() => request && answer(request.id, false)}
    >
      <View style={styles.scrim}>
        {request ? (
          <DialogCard key={request.id}>
            <Text style={styles.title}>{request.title}</Text>
            {request.message ? <Text style={styles.message}>{request.message}</Text> : null}

            <View style={styles.buttons}>
              {request.cancelLabel ? (
                <PressScale
                  containerStyle={styles.buttonSlot}
                  style={styles.cancel}
                  onPress={() => answer(request.id, false)}
                  hitSlop={4}
                >
                  <Text style={styles.cancelText}>{request.cancelLabel}</Text>
                </PressScale>
              ) : null}

              <PressScale
                containerStyle={styles.buttonSlot}
                style={[styles.confirm, request.destructive && styles.confirmDestructive]}
                onPress={() => answer(request.id, true)}
                hitSlop={4}
              >
                <Text
                  style={[styles.confirmText, request.destructive && styles.confirmTextDestructive]}
                >
                  {request.confirmLabel}
                </Text>
              </PressScale>
            </View>
          </DialogCard>
        ) : null}
      </View>
    </Modal>
  );
}

/**
 * The card, springing up and fading in to meet the scrim's fade.
 *
 * Mounted fresh per request (keyed on its id), so the entrance always starts
 * from the same offset without anyone having to rewind it. Only the entrance is
 * animated: the Modal's own fade covers the exit, and animating that out would
 * mean holding an answered dialog on screen waiting for it.
 */
function DialogCard({ children }: { children: ReactNode }) {
  const styles = useStyles(make);
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      scale.setValue(1);
      return;
    }

    const animation = Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: DURATION.enter,
        easing: Easing.bezier(...CURVE.enter),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        tension: 180,
        friction: 15,
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [progress, reduced, scale]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: progress,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(20, 28, 36, 0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 28,
    },
    card: {
      width: '100%',
      maxWidth: 400,
      padding: 22,
      borderRadius: radius.ticket,
      backgroundColor: t.ground,
      gap: 10,
    },
    title: { color: t.ink, fontSize: 18, fontWeight: '800' },
    message: { color: t.muted, fontSize: 14, lineHeight: 21 },

    buttons: { flexDirection: 'row', gap: 10, marginTop: 8 },
    buttonSlot: { flexGrow: 1, flexBasis: 0 },
    cancel: {
      height: 48,
      borderRadius: radius.round,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelText: { color: t.ink, fontSize: 15, fontWeight: '700' },
    confirm: {
      height: 48,
      borderRadius: radius.round,
      backgroundColor: t.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmDestructive: { backgroundColor: SHARED.danger },
    confirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    confirmTextDestructive: { color: '#FFFFFF' },
  });
