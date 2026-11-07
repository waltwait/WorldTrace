/** Which page a horizontal scroll position has reached. */

export function pageAt(offset: number, width: number, pages: number): number {
  if (width <= 0) return 0;
  return Math.max(0, Math.min(pages - 1, Math.round(offset / width)));
}

/** The pages a drag from here could show. */
export function pagesBeside(page: number, pages: number): number[] {
  return [page - 1, page + 1].filter((neighbour) => neighbour >= 0 && neighbour < pages);
}

/** Interpolation stops from horizontal scroll offset to a toolbar pill's x position. */
export function pagerStops(
  width: number,
  pages: number,
  step: number,
): { inputRange: number[]; outputRange: number[] } | null {
  if (width <= 0 || pages < 2) return null;
  const indices = Array.from({ length: pages }, (_, i) => i);
  return {
    inputRange: indices.map((i) => i * width),
    outputRange: indices.map((i) => i * step),
  };
}

/**
 * How a page's name follows the pager: full size and strong while its page shows,
 * `small` and quiet one page either side, and in between as far as the swipe has got.
 * `shrink` is the share of its width it gives up, which the names after it move left by.
 */
export function tabMotion(
  index: number,
  width: number,
  small: number,
): { inputRange: number[]; scale: number[]; strong: number[]; quiet: number[]; shrink: number[] } {
  return {
    inputRange: [(index - 1) * width, index * width, (index + 1) * width],
    scale: [small, 1, small],
    strong: [0, 1, 0],
    quiet: [1, 0, 1],
    shrink: [1 - small, 0, 1 - small],
  };
}
