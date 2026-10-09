/**
 * One answer per question, even when the question is asked twice at once.
 *
 * The expensive reads here — the whole track, to add up distance and to find
 * the personal bests — are cached once they finish. That does nothing for two
 * callers who arrive while the first is still reading: neither finds an answer,
 * so each runs the scan, and on a phone with a year of points each scan is the
 * slow part of launch. Caching the promise instead of the result closes the gap.
 *
 * A read that fails is forgotten, so the next caller tries again rather than
 * being handed the same failure for as long as the data stays put.
 */

export interface SharedReads<S, V> {
  /**
   * The answer for `signature`, from a read already under way or finished if
   * there is one for the same signature, otherwise from a fresh `read`.
   */
  get(owner: object, signature: S, read: () => Promise<V>): Promise<V>;
}

export function sharedReads<S, V>(same: (a: S, b: S) => boolean): SharedReads<S, V> {
  const entries = new WeakMap<object, { signature: S; value: Promise<V> }>();

  return {
    get(owner, signature, read) {
      const existing = entries.get(owner);
      if (existing && same(existing.signature, signature)) return existing.value;

      const entry = { signature, value: read() };
      entries.set(owner, entry);

      entry.value.catch(() => {
        if (entries.get(owner) === entry) entries.delete(owner);
      });

      return entry.value;
    },
  };
}
