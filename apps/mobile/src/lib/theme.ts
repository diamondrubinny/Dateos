import { useColorScheme } from 'react-native';

/** Contrast-checked tokens: text on background and on primary meet WCAG AA (≥ 4.5:1). */
const light = {
  background: '#FFFFFF',
  surface: '#F6F3FF',
  border: '#D9D2EE',
  text: '#1B1530',
  muted: '#5B5470',
  primary: '#6D28D9',
  onPrimary: '#FFFFFF',
  primarySoft: '#EDE5FF',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
  success: '#067647',
  successSoft: '#E7F6EC',
  focus: '#F59E0B',
};

const dark: typeof light = {
  background: '#120F1C',
  surface: '#1E1930',
  border: '#3A3352',
  text: '#F4F1FA',
  muted: '#B9B2CC',
  primary: '#A78BFA',
  onPrimary: '#120F1C',
  primarySoft: '#2E2550',
  danger: '#F97066',
  dangerSoft: '#3D1A17',
  success: '#47CD89',
  successSoft: '#123222',
  focus: '#FBBF24',
};

export type Colors = typeof light;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;
/** Minimum touch target (WCAG 2.5.5 / platform guidelines). */
export const MIN_TOUCH = 48;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
