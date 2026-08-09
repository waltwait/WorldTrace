/**
 * How a dialog looks. Everything about how one *behaves* is in dialog.ts.
 *
 * Rendered once, near the root, and driven by the queue rather than by props —
 * so any module can ask a question without every screen in between having to
 * pass a handler down.
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { answer, current, subscribe, type DialogRequest } from './dialog';
import { radius, theme } from './theme';

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
          <View style={styles.card}>
            <Text style={styles.title}>{request.title}</Text>
            {request.message ? <Text style={styles.message}>{request.message}</Text> : null}

            <View style={styles.buttons}>
              {request.cancelLabel ? (
                <Pressable
                  style={styles.cancel}
                  onPress={() => answer(request.id, false)}
                  hitSlop={4}
                >
                  <Text style={styles.cancelText}>{request.cancelLabel}</Text>
                </Pressable>
              ) : null}

              <Pressable
                style={[styles.confirm, request.destructive && styles.confirmDestructive]}
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
          </View>
        ) : null}
      </View>
    </Modal>
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
