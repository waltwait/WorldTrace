/**
 * Starting the background task, as a decision a test can reach.
 *
 * expo-location only starts the foreground service (and with it the "recording"
 * notification) when a task is registered while the app is in front, because
 * Android forbids starting one from the background. A task the OS has saved
 * across a restart comes back in the background, so its service is refused, and
 * the process is then a cached one that the system kills for memory whenever it
 * likes. Asking "is it running?" and stopping there — as this used to — left it
 * that way for good: the next launch found the task and never asked again.
 *
 * So the task is registered every time. Registering one that exists just updates
 * its options, which restarts the updates and, now that the app is in front,
 * starts the service.
 */

export interface LocationTaskPort {
  isStarted(): Promise<boolean>;
  start(): Promise<void>;
}

/** The code expo-location's `ForegroundServiceStartNotAllowedException` reaches JS with. */
export const FOREGROUND_SERVICE_REFUSED = 'ERR_FOREGROUND_SERVICE_START_NOT_ALLOWED';

export function isRefusedFromBackground(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === FOREGROUND_SERVICE_REFUSED
  );
}

export async function startRecordingTask(task: LocationTaskPort): Promise<void> {
  const running = await task.isStarted();

  try {
    await task.start();
  } catch (error) {
    // The app was not in front at that moment. A task that is already running
    // goes on recording, only without the protection; one that is not running
    // never started, which is a real failure.
    if (running && isRefusedFromBackground(error)) return;
    throw error;
  }
}
