/** The floating toolbar: four pages, and the one action that matters from any of them. */

import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { PressScale } from './PressScale';
import { useTheme } from './ThemeProvider';
import { radius } from './themes';

export const TABS: ReadonlyArray<{ label: string; icon: IconName }> = [
  { label: '總覽', icon: 'home' },
  { label: '足跡', icon: 'list' },
  { label: '航班', icon: 'plane' },
  { label: '設定', icon: 'gear' },
];

export function Toolbar({
  active,
  onSelect,
  onAdd,
}: {
  active: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
}) {
  const t = useTheme();

  return (
    <View style={styles.bar} pointerEvents="box-none">
      <View style={[styles.tabs, { backgroundColor: t.ink }]}>
        {TABS.map((tab, index) => (
          <PressScale
            key={tab.label}
            style={[styles.tab, index === active && { backgroundColor: t.accent }]}
            onPress={() => onSelect(index)}
            label={tab.label}
          >
            <Icon name={tab.icon} color={index === active ? t.ink : '#FFFFFF'} />
          </PressScale>
        ))}
      </View>
      <PressScale style={[styles.add, { backgroundColor: t.accent }]} onPress={onAdd} label="新增航班">
        <Icon name="plus" color={t.ink} size={26} />
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  tabs: { flexDirection: 'row', gap: 4, padding: 6, borderRadius: radius.round },
  tab: { width: 56, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  add: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
