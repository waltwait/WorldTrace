/**
 * A date, chosen from a calendar rather than typed.
 *
 * Drawn by the app rather than the system's picker, for the same reason as its
 * dialogs: it takes the theme. What a month holds is calendar.ts, which is tested.
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { monthOf, monthWeeks, shiftMonth, todayString, yearPage, type Month } from './calendar';
import { Icon } from './Icon';
import { PressScale } from './PressScale';
import { useStyles, useTheme } from './ThemeProvider';
import { FONT, radius, type Theme } from './themes';
import { Text } from './Text';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function DateField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
}) {
  const styles = useStyles(make);
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <PressScale style={styles.box} onPress={() => setOpen(true)} label={label}>
        <Text style={value ? styles.value : styles.placeholder} numberOfLines={1}>
          {value || placeholder}
        </Text>
      </PressScale>
      <Calendar
        visible={open}
        value={value}
        onClose={() => setOpen(false)}
        onPick={(date) => {
          onChange(date);
          setOpen(false);
        }}
      />
    </View>
  );
}

function Calendar({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  value: string;
  onClose: () => void;
  onPick: (date: string) => void;
}) {
  const styles = useStyles(make);
  const t = useTheme();
  const [shown, setShown] = useState<Month>(() => monthOf(value, new Date()));
  const [choosingYear, setChoosingYear] = useState(false);
  const [yearFrom, setYearFrom] = useState(shown.year);

  // Each opening starts from what is in the box, not from wherever the last one
  // was left.
  useEffect(() => {
    if (!visible) return;
    const month = monthOf(value, new Date());
    setShown(month);
    setYearFrom(month.year);
    setChoosingYear(false);
  }, [visible, value]);

  const years = yearPage(yearFrom);
  const today = todayString(new Date());

  const step = (by: number) => {
    if (choosingYear) setYearFrom(by > 0 ? years[years.length - 1] + 1 : years[0] - 1);
    else setShown((month) => shiftMonth(month, by));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="關閉" />
        <View style={styles.card}>
          <View style={styles.header}>
            <PressScale style={styles.arrow} onPress={() => step(-1)} label="往前" hitSlop={6}>
              <Icon name="back" color={t.ink} size={20} />
            </PressScale>
            <PressScale onPress={() => setChoosingYear((v) => !v)} hitSlop={8}>
              <Text style={styles.title}>
                {choosingYear
                  ? `${years[0]} – ${years[years.length - 1]}`
                  : `${shown.year} 年 ${shown.month} 月`}
              </Text>
            </PressScale>
            <PressScale style={styles.arrow} onPress={() => step(1)} label="往後" hitSlop={6}>
              <Icon name="chevronRight" color={t.ink} size={20} />
            </PressScale>
          </View>

          {choosingYear ? (
            <View style={styles.years}>
              {years.map((year) => (
                <PressScale
                  key={year}
                  containerStyle={styles.yearSlot}
                  style={[styles.year, year === shown.year && styles.on]}
                  onPress={() => {
                    setShown({ year, month: shown.month });
                    setChoosingYear(false);
                  }}
                >
                  <Text style={[styles.dayText, year === shown.year && styles.onText]}>{year}</Text>
                </PressScale>
              ))}
            </View>
          ) : (
            <>
              <View style={styles.week}>
                {WEEKDAYS.map((day) => (
                  <Text key={day} style={styles.weekday}>
                    {day}
                  </Text>
                ))}
              </View>
              {monthWeeks(shown).map((week, row) => (
                <View key={row} style={styles.week}>
                  {week.map((date, column) =>
                    date === null ? (
                      <View key={column} style={styles.daySlot} />
                    ) : (
                      <PressScale
                        key={date}
                        containerStyle={styles.daySlot}
                        style={[
                          styles.day,
                          date === today && styles.today,
                          date === value && styles.on,
                        ]}
                        onPress={() => onPick(date)}
                        label={date}
                      >
                        <Text style={[styles.dayText, date === value && styles.onText]}>
                          {Number(date.slice(8))}
                        </Text>
                      </PressScale>
                    ),
                  )}
                </View>
              ))}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const make = (t: Theme) =>
  StyleSheet.create({
    field: { flex: 1, minWidth: 0, gap: 6 },
    label: { color: t.muted, fontSize: 13, paddingLeft: 6 },
    box: {
      height: 52,
      paddingHorizontal: 16,
      borderRadius: 18,
      backgroundColor: t.soft,
      justifyContent: 'center',
    },
    value: { color: t.ink, fontFamily: FONT.bold, fontSize: 17 },
    placeholder: { color: t.muted, fontFamily: FONT.bold, fontSize: 17 },

    scrim: {
      flex: 1,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(20, 28, 36, 0.5)',
    },
    card: {
      width: '100%',
      maxWidth: 360,
      padding: 14,
      gap: 4,
      borderRadius: radius.ticket,
      backgroundColor: t.ground,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    arrow: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { color: t.ink, fontFamily: FONT.bold, fontSize: 17 },

    week: { flexDirection: 'row' },
    weekday: { flex: 1, color: t.muted, fontSize: 13, textAlign: 'center', paddingVertical: 6 },
    daySlot: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
    day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    today: { backgroundColor: t.soft },
    on: { backgroundColor: t.ink },
    dayText: { color: t.ink, fontFamily: FONT.bold, fontSize: 15 },
    onText: { color: '#FFFFFF' },

    years: { flexDirection: 'row', flexWrap: 'wrap' },
    yearSlot: { width: '33.33%', padding: 4 },
    year: { height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  });
