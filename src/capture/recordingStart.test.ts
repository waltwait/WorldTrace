import { describe, expect, test, vi } from 'vitest';
import {
  FOREGROUND_SERVICE_REFUSED,
  isRefusedFromBackground,
  startRecordingTask,
  type LocationTaskPort,
} from './recordingStart';

/** What expo-modules-kotlin hands JS: a CodedException carries a `code`. */
function coded(code: string, message = 'native failure'): Error {
  return Object.assign(new Error(message), { code });
}

const refused = () => coded(FOREGROUND_SERVICE_REFUSED, 'Foreground service cannot be started');

function port(started: boolean, start: () => Promise<void> = () => Promise.resolve()): LocationTaskPort {
  return { isStarted: () => Promise.resolve(started), start: vi.fn(start) };
}

describe('startRecordingTask', () => {
  test('starts the task when it is not running', async () => {
    const task = port(false);

    await startRecordingTask(task);

    expect(task.start).toHaveBeenCalledTimes(1);
  });

  // The whole point. A task the OS saved across a restart is already "started",
  // but it came back in the background, where Android refused its foreground
  // service. Registering it again, now that the app is in front, is the one
  // moment the service can be started.
  test('registers the task again when it is already running', async () => {
    const task = port(true);

    await startRecordingTask(task);

    expect(task.start).toHaveBeenCalledTimes(1);
  });

  describe('when Android refuses the foreground service because the app is in the background', () => {
    test('carries on if the task was already running: nothing is lost, only unprotected', async () => {
      const task = port(true, () => Promise.reject(refused()));

      await expect(startRecordingTask(task)).resolves.toBeUndefined();
    });

    test('fails if the task was not running: recording never started', async () => {
      const task = port(false, () => Promise.reject(refused()));

      await expect(startRecordingTask(task)).rejects.toMatchObject({ code: FOREGROUND_SERVICE_REFUSED });
    });
  });

  test('lets any other failure through even when the task is running', async () => {
    const task = port(true, () => Promise.reject(coded('ERR_LOCATION_BACKGROUND_UNAUTHORIZED')));

    await expect(startRecordingTask(task)).rejects.toMatchObject({
      code: 'ERR_LOCATION_BACKGROUND_UNAUTHORIZED',
    });
  });

  test('lets a failure with no code through', async () => {
    const task = port(true, () => Promise.reject(new Error('boom')));

    await expect(startRecordingTask(task)).rejects.toThrow('boom');
  });

  test('asks whether the task is running before it starts it', async () => {
    const order: string[] = [];
    const task: LocationTaskPort = {
      isStarted: () => (order.push('isStarted'), Promise.resolve(false)),
      start: () => (order.push('start'), Promise.resolve()),
    };

    await startRecordingTask(task);

    expect(order).toEqual(['isStarted', 'start']);
  });
});

describe('isRefusedFromBackground', () => {
  test('recognises the refusal by its code', () => {
    expect(isRefusedFromBackground(refused())).toBe(true);
  });

  test('does not take another coded error for it', () => {
    expect(isRefusedFromBackground(coded('ERR_FOREGROUND_SERVICE_PERMISSIONS'))).toBe(false);
  });

  test('does not take things that are not errors for it', () => {
    expect(isRefusedFromBackground(null)).toBe(false);
    expect(isRefusedFromBackground(undefined)).toBe(false);
    expect(isRefusedFromBackground('ERR_FOREGROUND_SERVICE_START_NOT_ALLOWED')).toBe(false);
  });
});
