/**
 * How a dialog looks. Everything about how one *behaves* is in dialog.ts.
 *
 * Rendered once, near the root, and driven by the queue rather than by props —
 * so any module can ask a question without every screen in between having to
 * pass a handler down.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { answer, current, subscribe, type DialogRequest } from './dialog';
import { radius, theme } from './theme';
import { useReducedMotion } from './useReducedMotion';

export function DialogHost() {
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
                <Pressable
                  style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]}
                  onPress={() => answer(request.id, false)}
                  hitSlop={4}
                >
                  <Text style={styles.cancelText}>{request.cancelLabel}</Text>
                </Pressable>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.confirm,
                  request.destructive && styles.confirmDestructive,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => answer(request.id, true)}
                hitSlop={4}
              >
                <Text
                  style={[styles.confirmText, request.destructive && styles.confirmTextDestructive]}
                >
                  {request.confirmLabel}
                </Text>
              </Pressable>
            </View>
          </DialogCard>
        ) : null}
      </View>
    </Modal>
  );
}

/**
 * The card, springing up to meet the scrim's fade.
 *
 * Mounted fresh per request (keyed on its id), so the scale always starts from
 * 0.9 without anyone having to rewind it. Only the entrance is animated: the
 * Modal's own fade covers the exit, and animating that out would mean holding
 * an answered dialog on screen waiting for it.
 */
function DialogCard({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (reduced) {
      scale.setValue(1);
      return;
    }

    const animation = Animated.spring(scale, {
      toValue: 1,
      tension: 180,
      friction: 15,
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [reduced, scale]);

  return (
    <Animated.View style={[styles.card, { transform: [{ scale }] }]}>{children}</Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(2, 5, 12, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    padding: 20,
    borderRadius: radius.panel,
    backgroundColor: theme.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    gap: 10,
  },
  title: { color: theme.text, fontSize: 17, fontWeight: '700' },
  message: { color: theme.textFaint, fontSize: 12, lineHeight: 19 },

  buttons: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancel: {
    flexGrow: 1,
    flexBasis: 0,
    paddingVertical: 12,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
  },
  cancelText: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
  confirm: {
    flexGrow: 1,
    flexBasis: 0,
    paddingVertical: 12,
    borderRadius: radius.card,
    backgroundColor: theme.accent,
    alignItems: 'center',
  },
  confirmDestructive: { backgroundColor: theme.danger },
  confirmText: { color: '#04101f', fontSize: 13, fontWeight: '700' },
  confirmTextDestructive: { color: '#2a0808' },
});
