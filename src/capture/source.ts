/**
 * Where fixes come from.
 *
 * The recording pipeline does not care whether a fix arrived from the GPS
 * chip or from a file. That is the point: the whole of `store` and
 * `gatekeeper` can be driven from a recorded track on a laptop, and only the
 * implementations behind this interface touch platform APIs.
 */

import type { Fix } from '../gatekeeper/gatekeeper';

export interface LocationSource {
  /** Begin emitting fixes. Resolves when the source is exhausted or stopped. */
  start(onFix: (fix: Fix) => void | Promise<void>): Promise<void>;
  stop(): Promise<void>;
}
