/** Which page a horizontal scroll position has reached. */

export function pageAt(offset: number, width: number, pages: number): number {
  if (width <= 0) return 0;
  return Math.max(0, Math.min(pages - 1, Math.round(offset / width)));
}

/** The pages a drag from here could show. */
export function pagesBeside(page: number, pages: number): number[] {
  return [page - 1, page + 1].filter((neighbour) => neighbour >= 0 && neighbour < pages);
}
