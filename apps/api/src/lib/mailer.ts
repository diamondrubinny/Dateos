// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import nodemailer from 'nodemailer';
import { creditHtml, creditLine } from '@nexaheart/shared';
import type { Env } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  close(): void;
}

export function createMailer(env: Env): Mailer {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
  });
  return {
    async send(message) {
      await transport.sendMail({ from: env.SMTP_FROM, ...message });
    },
    close: () => transport.close(),
  };
}

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => htmlEscapes[char]!);
}

/** Bilingual (Hebrew + English) sign-in email. No tracking pixels, no external images. */
export function magicLinkEmail(instanceName: string, url: string): Omit<MailMessage, 'to'> {
  const name = escapeHtml(instanceName);
  const link = escapeHtml(url);
  return {
    subject: `${instanceName}: כניסה לחשבון / Sign in`,
    text: [
      `כניסה ל-${instanceName}: ${url}`,
      'הקישור תקף ל-10 דקות. אם לא ביקשת להתחבר, אפשר להתעלם מהודעה זו.',
      '',
      `Sign in to ${instanceName}: ${url}`,
      'The link expires in 10 minutes. If you did not ask to sign in, ignore this email.',
      '',
      creditLine('he'),
      creditLine('en'),
    ].join('\n'),
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<div dir="rtl" lang="he"><h1 style="font-size:20px">כניסה ל-${name}</h1>
<p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#7C3AED;color:#fff;border-radius:8px;text-decoration:none">כניסה לחשבון</a></p>
<p>הקישור תקף ל-10 דקות. אם לא ביקשת להתחבר, אפשר להתעלם מהודעה זו.</p></div>
<hr>
<div dir="ltr" lang="en"><h1 style="font-size:20px">Sign in to ${name}</h1>
<p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#7C3AED;color:#fff;border-radius:8px;text-decoration:none">Sign in</a></p>
<p>The link expires in 10 minutes. If you did not ask to sign in, ignore this email.</p></div>
<hr>
${creditHtml('he')}
${creditHtml('en')}
</body></html>`,
  };
}
