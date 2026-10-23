// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo } from 'react-native';
import { prefs } from './storage';

/**
 * Display and ease of use (phase 25). Kept on this device only: nobody, not even the server, learns
 * who chose bigger text or easy mode.
 */
export const DISPLAY_KEY = 'nexaheart.display';

export const textSizes = ['standard', 'large', 'larger'] as const;
export type TextSize = (typeof textSizes)[number];
export const TEXT_SCALE: Record<TextSize, number> = { standard: 1, large: 1.25, larger: 1.5 };

export interface DisplaySettings {
  textSize: TextSize;
  /** Fewer tabs and menus, bigger buttons, a short explanation under each action. */
  easy: boolean;
  /** Muted text and borders at full contrast. */
  contrast: boolean;
  /** Skip animations even when the system doesn't ask for it. */
  reduceMotion: boolean;
}

export const defaultDisplay: DisplaySettings = {
  textSize: 'standard',
  easy: false,
  contrast: false,
  reduceMotion: false,
};

/** Reads stored settings defensively: anything unexpected falls back to the default. */
export function parseDisplay(raw: string | null): DisplaySettings {
  if (!raw) return defaultDisplay;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof DisplaySettings, unknown>>;
    return {
      textSize: textSizes.includes(v.textSize as TextSize)
        ? (v.textSize as TextSize)
        : defaultDisplay.textSize,
      easy: v.easy === true,
      contrast: v.contrast === true,
      reduceMotion: v.reduceMotion === true,
    };
  } catch {
    return defaultDisplay;
  }
}

interface DisplayState extends DisplaySettings {
  /** The text multiplier (on top of the system's own text size). */
  scale: number;
  /** Animations off: the member's choice, or the system's "reduce motion". */
  motionOff: boolean;
  update: (change: Partial<DisplaySettings>) => void;
}

const fallback: DisplayState = {
  ...defaultDisplay,
  scale: 1,
  motionOff: false,
  update: () => undefined,
};

const DisplayContext = createContext<DisplayState>(fallback);

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DisplaySettings>(defaultDisplay);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void prefs.get(DISPLAY_KEY).then((raw) => {
      if (!cancelled) setSettings(parseDisplay(raw));
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => !cancelled && setSystemReduceMotion(on))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduceMotion);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const update = useCallback((change: Partial<DisplaySettings>) => {
    setSettings((current) => {
      const next = { ...current, ...change };
      void prefs.set(DISPLAY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<DisplayState>(
    () => ({
      ...settings,
      scale: TEXT_SCALE[settings.textSize],
      motionOff: settings.reduceMotion || systemReduceMotion,
      update,
    }),
    [settings, systemReduceMotion, update],
  );
  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

export function useDisplay(): DisplayState {
  return useContext(DisplayContext);
}
