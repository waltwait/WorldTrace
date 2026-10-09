/**
 * Which tabs have been opened so far.
 *
 * Every screen used to mount at launch, hidden ones included, and a hidden
 * screen still runs its effects: the stats screen read the whole track and every
 * fog tile, the timeline grouped every point by day, all while the map — the one
 * screen anyone is looking at — was still trying to draw. A screen now mounts
 * the first time its tab is opened.
 *
 * It stays mounted afterwards. The pager slides pages past each other, and
 * tearing one down and rebuilding it on every visit would cost more than it
 * saved (see SlideScreen in App.tsx).
 */
export function openTab(opened: ReadonlySet<number>, tab: number): ReadonlySet<number> {
  if (opened.has(tab)) return opened;

  const next = new Set(opened);
  next.add(tab);
  return next;
}
