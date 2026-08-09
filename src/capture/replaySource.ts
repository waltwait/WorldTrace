/**
 * A LocationSource that replays a recorded track.
 *
 * Used for development and for end-to-end tests: it drives the real
 * gatekeeper, the real fog engine and a real database without anyone having
 * to walk outside. Deliberately not a mock — the code under it is the same
 * code that runs on a phone.
 */

import type { Fix } from '../gatekeeper/gatekeeper';
import type { LocationSource } from './source';

export interface ReplayOptions {
  /** Wall-clock pause between fixes, so fog can be watched clearing. */
  intervalMs?: number;
  /** Injectable for tests, which have no patience. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createReplaySource(
  fixes: Fix[],
  options: ReplayOptions = {},
): LocationSource {
  const { intervalMs = 1000, sleep = realSleep } = options;
  let running = false;

  return {
    async start(onFix) {
      running = true;

      for (const fix of fixes) {
        if (!running) break;
        await sleep(intervalMs);
        if (!running) break;

        // Awaited so a slow consumer cannot be lapped — the pipeline must see
        // fixes strictly in order or the gatekeeper's speed checks are wrong.
        await onFix(fix);
      }

      running = false;
    },

    async stop() {
      running = false;
    },
  };
}
