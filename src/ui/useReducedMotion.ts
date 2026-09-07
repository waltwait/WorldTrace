/**
 * Whether the system has been told to keep motion to a minimum.
 *
 * Every animation in the app reads this and jumps straight to its end state
 * when it is on. Motion sensitivity is not a preference to be talked out of:
 * for some people a sliding screen is nausea, not polish.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduced(enabled);
      })
      .catch(() => {
        // An unreadable setting is not a reason to refuse to animate.
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}
