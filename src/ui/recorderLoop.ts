/**
 * The recorder's startup and polling, apart from React.
 *
 * Two decisions here used to sit inside the hook where nothing could test them.
 *
 * The first is order. The track used to be read only after the background task
 * had started, so the permission prompt and the task manager's own setup sat in
 * front of the map showing anything — and a refused permission meant the
 * history never loaded at all, though reading it needs no permission. Starting
 * the recording and reading the history are independent, so they run side by
 * side and each reports as it finishes.
 *
 * The second is overlap. The poll fires every few seconds whether or not the
 * last read has returned, and a read that takes longer than the interval — a
 * large database on a busy phone — used to pile up behind itself.
 */

export type LoopStatus = 'recording' | 'denied' | 'failed';

export interface RecorderLoopDeps<Driver, Snapshot> {
  open(): Promise<Driver>;
  /** Start background recording. Rejects if it cannot. */
  start(): Promise<void>;
  read(driver: Driver): Promise<Snapshot>;
  /** Whether a start failure is the user declining location permission. */
  isDenied(error: unknown): boolean;
  onSnapshot(snapshot: Snapshot): void;
  onStatus(status: LoopStatus, error?: string): void;
  /** A poll that failed. The loop carries on; the next one may succeed. */
  onReadError(error: unknown): void;
  intervalMs: number;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function runRecorderLoop<Driver, Snapshot>(
  deps: RecorderLoopDeps<Driver, Snapshot>,
): { stop(): void } {
  let stopped = false;
  let reading = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let readFailed = false;

  /** One read at a time. Returns without reading if one is already going. */
  const read = async (driver: Driver): Promise<void> => {
    if (reading) return;

    reading = true;
    try {
      const snapshot = await deps.read(driver);
      if (!stopped) deps.onSnapshot(snapshot);
    } finally {
      reading = false;
    }
  };

  void (async () => {
    let driver: Driver;

    try {
      driver = await deps.open();
    } catch (error) {
      if (!stopped) deps.onStatus('failed', messageOf(error));
      return;
    }
    if (stopped) return;

    deps
      .start()
      .then(
        () => {
          if (stopped) return;

          if (!readFailed) deps.onStatus('recording');

          timer = setInterval(() => {
            read(driver).catch((error) => {
              if (!stopped) deps.onReadError(error);
            });
          }, deps.intervalMs);
        },
        (error: unknown) => {
          if (stopped) return;
          deps.onStatus(deps.isDenied(error) ? 'denied' : 'failed', messageOf(error));
        },
      );

    read(driver).catch((error: unknown) => {
      if (stopped) return;
      readFailed = true;
      deps.onStatus('failed', messageOf(error));
    });
  })();

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
