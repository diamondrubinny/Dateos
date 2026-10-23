// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { CAPTCHA_SCRIPT, type CaptchaProps } from '../lib/captcha';
import { webUrl } from '../lib/config';
import { useInstance } from '../lib/queries';

/** The widget's page: the provider's script and a box, nothing else. */
function page(provider: 'turnstile' | 'hcaptcha', siteKey: string, language: string): string {
  const api = provider === 'turnstile' ? 'turnstile' : 'hcaptcha';
  // Escaped for an inline script: no </script> can close it early.
  const options = JSON.stringify({ sitekey: siteKey, language, hl: language }).replace(
    /</g,
    '\\u003c',
  );
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:transparent}</style>
<script src="${CAPTCHA_SCRIPT[provider]}" async onload="go()"></script></head>
<body><div id="box"></div><script>
function send(v){window.ReactNativeWebView.postMessage(JSON.stringify(v))}
function go(){var o=${options};o.callback=function(t){send({token:t})};
o['expired-callback']=function(){send({token:null})};o['error-callback']=function(){send({token:null})};
window.${api}.render(document.getElementById('box'),o)}
</script></body></html>`;
}

/**
 * Bot protection (phase 24), native: the provider's widget in a small web view. Its page is served
 * as if from the community's web address, the domain the site key allows. 📘
 */
export function Captcha({ onToken, resetKey = 0 }: CaptchaProps) {
  const { t, i18n } = useTranslation();
  const info = useInstance().data?.integrations.captcha;
  if (!info) return null;
  return (
    <View
      testID="captcha"
      role="group"
      accessibilityLabel={t('captcha.label')}
      style={{ height: 80 }}
    >
      <WebView
        key={resetKey}
        originWhitelist={['https://*']}
        source={{ html: page(info.provider, info.siteKey, i18n.language), baseUrl: webUrl() }}
        onMessage={(event: WebViewMessageEvent): void => {
          try {
            const data = JSON.parse(event.nativeEvent.data) as { token?: string | null };
            onToken(typeof data.token === 'string' ? data.token : null);
          } catch {
            onToken(null);
          }
        }}
        javaScriptEnabled
        scrollEnabled={false}
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
