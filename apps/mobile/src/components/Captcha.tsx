// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { type ComponentRef, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { CAPTCHA_SCRIPT, type CaptchaProps } from '../lib/captcha';
import { useInstance } from '../lib/queries';

interface Widget {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove?(id: string): void;
  reset?(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Widget;
    hcaptcha?: Widget;
  }
}

const loading = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loading.has(src)) {
    loading.set(
      src,
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          loading.delete(src);
          reject(new Error('captcha script'));
        };
        document.head.appendChild(script);
      }),
    );
  }
  return loading.get(src)!;
}

/**
 * Bot protection (phase 24), web: the provider's widget, only when the community set one up.
 * The script loads only on the pages that need it.
 */
export function Captcha({ onToken, resetKey = 0 }: CaptchaProps) {
  const { t, i18n } = useTranslation();
  const info = useInstance().data?.integrations.captcha;
  const box = useRef<ComponentRef<typeof View>>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    if (!info) return;
    let id: string | undefined;
    let api: Widget | undefined;
    let cancelled = false;
    void loadScript(CAPTCHA_SCRIPT[info.provider])
      .then(() => {
        api = info.provider === 'turnstile' ? window.turnstile : window.hcaptcha;
        const el = box.current as unknown as HTMLElement | null;
        if (cancelled || !api || !el) return;
        id = api.render(el, {
          sitekey: info.siteKey,
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(null),
          'error-callback': () => callback.current(null),
          // Turnstile picks the visitor's language; hCaptcha reads `hl`.
          language: i18n.language,
          hl: i18n.language,
        });
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (id && api?.remove) api.remove(id);
      callback.current(null);
    };
  }, [info, resetKey, i18n.language]);

  if (!info) return null;
  return (
    <View
      ref={box}
      testID="captcha"
      role="group"
      accessibilityLabel={t('captcha.label')}
      style={{ minHeight: 70 }}
    />
  );
}
