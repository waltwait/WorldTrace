/** The app's icons: stroked, one weight, drawn in whatever colour they are given. */

import Svg, { Path } from 'react-native-svg';

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'm15 5-7 7 7 7',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  check: 'm5 12 5 5 9-10',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  home: 'M4 11 12 4l8 7v9H4v-9Z',
  plane: 'M21 3 3 10.5l7 3 3 7L21 3Z',
  gear: 'M9.37 5.30L9.59 2.29L14.41 2.29L14.63 5.30L16.49 6.37L19.20 5.06L21.61 9.24L19.12 10.92L19.12 13.08L21.61 14.76L19.20 18.94L16.49 17.63L14.63 18.70L14.41 21.71L9.59 21.71L9.37 18.70L7.51 17.63L4.80 18.94L2.39 14.76L4.88 13.08L4.88 10.92L2.39 9.24L4.80 5.06L7.51 6.37ZM15.4 12a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0Z',
  image:
    'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM10.6 10a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0ZM4 18l5-5 4 4 3-3 4 4',
  share: 'M12 15V4M7 9l5-5 5 5M5 14v5h14v-5',
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
