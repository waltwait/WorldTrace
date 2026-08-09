/**
 * One place for the palette, so the screens stay consistent as they grow.
 *
 * Deliberately dark: the map is mostly fog, and a light chrome around a dark
 * map fights it for attention.
 */

export const theme = {
  background: '#070b16',
  surface: 'rgba(9, 14, 28, 0.94)',
  surfaceSolid: '#0c1223',
  border: 'rgba(255, 255, 255, 0.12)',

  text: '#f4f6ff',
  textMuted: '#c8d0ea',
  textFaint: '#6f7a9c',

  accent: '#5b9cff',
  live: '#4ade80',
  warn: '#ffcf8d',
  danger: '#ff9d9d',

  fog: '#070b16',
  fogOpacity: 0.86,
  trackLine: '#5b9cff',

  // Achievement tiers. Warm metals against the cold navy, so an earned tier
  // reads at a glance without needing to be counted.
  bronze: '#c9814f',
  silver: '#bcc6da',
  gold: '#e8c25a',
  tierLocked: 'rgba(255, 255, 255, 0.13)',
} as const;

export const radius = { panel: 20, card: 14, pill: 999 } as const;
