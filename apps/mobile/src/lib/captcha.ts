// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { CAPTCHA_HEADER, type CaptchaProvider } from '@nexaheart/shared';

/** The provider's script, rendered explicitly into our own box. 📘 each provider's client docs. */
export const CAPTCHA_SCRIPT: Record<CaptchaProvider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit',
};

/** The header for a request a CAPTCHA protects (nothing when there's no answer). */
export const captchaHeaders = (token: string | null | undefined): Record<string, string> =>
  token ? { [CAPTCHA_HEADER]: token } : {};

export interface CaptchaProps {
  /** The answer, or null when it expired or failed (ask again). */
  onToken: (token: string | null) => void;
  /** Change it to ask again (after a refused request: answers are single use). */
  resetKey?: number;
}
