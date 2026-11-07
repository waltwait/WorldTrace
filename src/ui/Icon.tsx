/** The app's icons: stroked, one weight, drawn in whatever colour they are given. */

import Svg, { Path } from 'react-native-svg';

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'm15 5-7 7 7 7',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  check: 'm5 12 5 5 9-10',
  home: 'M4 11 12 4l8 7v9H4v-9Z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  plane: 'M21 3 3 10.5l7 3 3 7L21 3Z',
  gear: 'M15.2 12a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0ZM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
  image:
    'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM10.6 10a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0ZM4 18l5-5 4 4 3-3 4 4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  color,
  size = 22,
  weight = 2,
}: {
  name: IconName;
  color: string;
  size?: number;
  weight?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={PATHS[name]}
        stroke={color}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
