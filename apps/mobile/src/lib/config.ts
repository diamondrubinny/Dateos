/** Public build-time config. Never put secrets in EXPO_PUBLIC_* variables. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);
export const APP_SCHEME = 'nexaheart';
