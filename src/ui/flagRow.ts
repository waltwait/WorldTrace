/**
 * The flags on the passport card share a line with its name, so only so many fit.
 * When they do not, the last place says how many more there are.
 */
export function flagRow(codes: readonly string[], room: number): { codes: string[]; more: number } {
  if (codes.length <= room) return { codes: [...codes], more: 0 };
  const shown = codes.slice(0, room - 1);
  return { codes: shown, more: codes.length - shown.length };
}
