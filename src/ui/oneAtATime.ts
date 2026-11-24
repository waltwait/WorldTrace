/**
 * Work that runs one at a time: a call while it is running joins that run.
 *
 * The flights refresh at launch and on a pull on 航班, and the two can meet.
 * Each ran the polls due — paid calls — over the same flights, since neither
 * had saved its answers yet, and the first to finish stopped the other's
 * spinner. The promise is shared, as store/sharedRead.ts shares a read, and
 * forgotten once it settles, failed or not, so the next call runs afresh.
 */
export function oneAtATime<T>(work: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    if (running) return running;
    const run = work().finally(() => {
      if (running === run) running = null;
    });
    running = run;
    return run;
  };
}
