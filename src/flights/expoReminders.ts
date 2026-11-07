/**
 * The reminders, on the phone's own notifications. What to remind and when is
 * reminders.ts, which is tested; this only hands it to Android.
 *
 * An exact alarm needs a permission Android 14 keeps off until the user turns it on in
 * the system's settings. Without it the library sets an ordinary alarm, which Android
 * may move by a few minutes: near enough for an hour's warning.
 */

import * as Notifications from 'expo-notifications';
import { planReminders, type Reminder } from './reminders';
import type { FlightRecord } from './types';

const CHANNEL = 'flights';
const OURS = 'flight-';

/** Shown while the app is open too; without a handler a notification is not shown. */
export function showRemindersInTheApp(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Makes the scheduled reminders match the flights: new ones set, stale ones taken away. */
export async function syncReminders(flights: readonly FlightRecord[], now: number): Promise<void> {
  const plan = planReminders(flights, now);
  const wanted = new Set(plan.map((reminder) => reminder.id));

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => request.identifier.startsWith(OURS) && !wanted.has(request.identifier))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
  if (plan.length === 0) return;

  // The channel first: Android 13 asks for the permission only once one exists. And
  // only now, with a reminder to set, rather than the first time the app opens.
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: '航班提醒',
    importance: Notifications.AndroidImportance.HIGH,
  });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return;

  // The same identifier replaces a reminder already set, so a change moves it.
  for (const reminder of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: {
        title: reminder.title,
        body: reminder.body,
        data: { flightId: reminder.flightId, opens: reminder.opens },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.at,
        channelId: CHANNEL,
      },
    });
  }
}

/**
 * Calls back with the flight a tapped reminder is for, the one that opened the app
 * included, and what it was a reminder to do.
 */
export function onReminderTapped(
  open: (flightId: string, opens: Reminder['opens'] | null) => void,
): () => void {
  const handle = (response: Notifications.NotificationResponse | null) => {
    const data = response?.notification.request.content.data;
    const flightId = data?.flightId;
    if (typeof flightId !== 'string') return;
    open(flightId, data?.opens === 'boardingPass' ? 'boardingPass' : null);
    // Or the next launch opens it again.
    void Notifications.clearLastNotificationResponseAsync();
  };

  void Notifications.getLastNotificationResponseAsync().then(handle);
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
