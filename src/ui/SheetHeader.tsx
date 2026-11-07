/**
 * The top of a full-screen page: the way out, and the name of the page. It sits
 * outside what scrolls, so the way out stays on the screen.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { PressScale } from './PressScale';
import { Text } from './Text';
import { useStyles, useTheme } from './ThemeProvider';
import type { Theme } from './themes';

export function SheetHeader({
  title,
  note,
  onBack,
  onClose,
  action,
  accessory,
}: {
  title?: string;
  /** A line under the title, such as a trip's dates. */
  note?: string;
  /** A page opened from another: the way out is on the left, before the title. */
  onBack?: () => void;
  /** A task to finish or give up: the way out is on the right. */
  onClose?: () => void;
  /** An optional secondary action on the right when `onBack` sits on the left. */
  action?: { icon: IconName; label: string; onPress: () => void };
  /** On the right, before `action`: a control of the page's own, such as its year. */
  accessory?: ReactNode;
}) {
  const styles = useStyles(make);
  const t = useTheme();

  return (
    <View style={styles.header}>
      {onBack ? (
        <PressScale style={styles.button} onPress={onBack} label="返回" hitSlop={8}>
          <Icon name="back" color={t.ink} />
        </PressScale>
      ) : null}
      {title && note ? (
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {title}
          </Text>
          <Text style={styles.note} numberOfLines={1}>
            {note}
          </Text>
        </View>
      ) : title ? (
        <Text style={styles.title}>{title}</Text>
      ) : null}
      {accessory || action || onClose ? (
        <View style={styles.end}>
          {accessory}
          {action ? (
            <PressScale style={styles.button} onPress={action.onPress} label={action.label} hitSlop={8}>
              <Icon name={action.icon} color={t.ink} size={20} />
            </PressScale>
          ) : onClose ? (
            <PressScale style={styles.button} onPress={onClose} label="關閉" hitSlop={8}>
              <Icon name="close" color={t.ink} size={20} />
            </PressScale>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 8,
      backgroundColor: t.ground,
    },
    title: { color: t.ink, fontSize: 30, fontWeight: '900' },
    titles: { flexShrink: 1 },
    note: { color: t.muted, fontSize: 13 },
    end: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 10 },
    button: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
