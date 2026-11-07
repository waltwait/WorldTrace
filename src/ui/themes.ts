/**
 * The themes: the same screens in four sets of colours.
 *
 * All of them are quiet except 鮮紫, which is the first draft of this look and
 * stayed because it was liked. `fog` is what the map's fog is drawn in, so a
 * theme reaches the map as well as the screens. Their contrast is pinned in
 * themes.test.ts: a theme nobody can read in is not a theme.
 */

/**
 * Sora, for what is read as figures: distances, times, airport codes. Each weight
 * is its own file and its own family, so a style names one of these and sets no
 * `fontWeight`. The names are the file names in assets/fonts; android/ has a copy,
 * which only a prebuild refreshes.
 */
export const FONT = { bold: 'Sora-Bold', extraBold: 'Sora-ExtraBold' } as const;

/** Noto Sans TC, for everything else. A style asks with `fontWeight`; see fonts.ts. */
export const NOTO = {
  regular: 'NotoSansTC-Regular',
  bold: 'NotoSansTC-Bold',
  black: 'NotoSansTC-Black',
} as const;

export type ThemeId = 'blue' | 'mauve' | 'graphite' | 'plum';

export interface Theme {
  id: ThemeId;
  name: string;
  /** Behind everything. */
  ground: string;
  /** The dark tiles: the next flight, the number on the map. */
  tile: string;
  /** Text, and the toolbar. */
  ink: string;
  /** What is selected, and the add button. */
  accent: string;
  /** The light tiles: groups of rows, past flights. */
  soft: string;
  /** Second-rank text on the ground and on soft tiles. */
  muted: string;
  /** Second-rank text on the dark tiles. */
  onTile: string;
  fog: string;
}

export const THEME_IDS: readonly ThemeId[] = ['blue', 'mauve', 'graphite', 'plum'];

export const THEMES: Record<ThemeId, Theme> = {
  blue: {
    id: 'blue',
    name: '灰藍',
    ground: '#F1F3F5',
    tile: '#415061',
    ink: '#1F2A36',
    accent: '#ABB9C6',
    soft: '#DEE4EA',
    muted: '#55636F',
    onTile: '#D3DBE3',
    fog: '#344456',
  },
  mauve: {
    id: 'mauve',
    name: '灰紫',
    ground: '#F4F2F5',
    tile: '#595365',
    ink: '#2B2730',
    accent: '#BDB3C8',
    soft: '#E4E0E8',
    muted: '#5F5968',
    onTile: '#DDD8E3',
    fog: '#4E475A',
  },
  graphite: {
    id: 'graphite',
    name: '石墨',
    ground: '#F3F3F1',
    tile: '#43474B',
    ink: '#222528',
    accent: '#BAB7B0',
    soft: '#E3E2DE',
    muted: '#5C5F62',
    onTile: '#D6D7D8',
    fog: '#363A3E',
  },
  plum: {
    id: 'plum',
    name: '鮮紫',
    ground: '#F5F0FA',
    tile: '#4E2B72',
    ink: '#2A1240',
    accent: '#FF7A6B',
    soft: '#E7DAF3',
    muted: '#5C4A70',
    onTile: '#DCCDEE',
    fog: '#421C68',
  },
};

export const DEFAULT_THEME: ThemeId = 'blue';

/** Colours that mean the same in every theme. */
export const SHARED = {
  /** The user's own position, and nothing else. */
  location: '#2F7DF6',
  live: '#7FE3A5',
  danger: '#A23B32',
  bronze: '#A9744A',
  silver: '#8C97A3',
  gold: '#C9A227',
} as const;

export const radius = {
  map: 40,
  ticket: 26,
  group: 22,
  round: 999,
} as const;

/** How much of the bottom of a page the floating toolbar covers. */
export const TOOLBAR_CLEARANCE = 112;

export function serializeThemeId(id: ThemeId): string {
  return JSON.stringify({ theme: id });
}

/** Anything unreadable is the default: a colour is not worth failing over. */
export function parseThemeId(text: string | null | undefined): ThemeId {
  try {
    const parsed = JSON.parse(text ?? '') as { theme?: unknown };
    return THEME_IDS.find((id) => id === parsed?.theme) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
