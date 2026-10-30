// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import nodemailer, { type Transporter } from 'nodemailer';
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

/**
 * Email through the server's SMTP settings, or (phase 24) the ones saved in the dashboard when
 * the server doesn't set SMTP_HOST.
 */
export function createMailer(
  env: Env,
  dashboard?: () => Promise<{ transport: Transporter; from: string } | null>,
): Mailer {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
  });
  return {
    async send(message) {
      const configured = await dashboard?.();
      if (configured) {
        await configured.transport.sendMail({ from: configured.from, ...message });
        return;
      }
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

/** A shared bilingual layout for short notices (Hebrew first, then English), with the credit. */
function bilingualNotice(
  subject: string,
  he: { title: string; body: string[] },
  en: { title: string; body: string[] },
  link?: { url: string; he: string; en: string },
): Omit<MailMessage, 'to'> {
  const button = (label: string) =>
    link
      ? `<p><a href="${escapeHtml(link.url)}" style="display:inline-block;padding:12px 20px;background:#7C3AED;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(label)}</a></p>`
      : '';
  const paragraphs = (lines: string[]) => lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
  return {
    subject,
    text: [
      he.title,
      ...he.body,
      ...(link ? [link.url] : []),
      '',
      en.title,
      ...en.body,
      ...(link ? [link.url] : []),
      '',
      creditLine('he'),
      creditLine('en'),
    ].join('\n'),
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<div dir="rtl" lang="he"><h1 style="font-size:20px">${escapeHtml(he.title)}</h1>${paragraphs(he.body)}${button(link?.he ?? '')}</div>
<hr>
<div dir="ltr" lang="en"><h1 style="font-size:20px">${escapeHtml(en.title)}</h1>${paragraphs(en.body)}${button(link?.en ?? '')}</div>
<hr>
${creditHtml('he')}
${creditHtml('en')}
</body></html>`,
  };
}

/**
 * Someone asked to sign in with an address that has no account while new accounts need an invite
 * or a place on the waitlist (phase 21). Only the mailbox owner learns this; the API answers the
 * same either way.
 */
export function signupClosedEmail(
  instanceName: string,
  mode: 'invite' | 'waitlist',
  appUrl: string,
): Omit<MailMessage, 'to'> {
  return bilingualNotice(
    `${instanceName}: הצטרפות / Joining`,
    {
      title: `הצטרפות ל-${instanceName}`,
      body: [
        mode === 'invite'
          ? 'כדי לפתוח חשבון צריך קוד הזמנה. אפשר להזין אותו במסך הכניסה, ואז לבקש קישור שוב.'
          : 'ההצטרפות כרגע דרך רשימת המתנה. אפשר להצטרף אליה במסך הכניסה, ונשלח מייל כשתאושר.',
        'אם לא ביקשת להתחבר, אפשר להתעלם מהודעה זו.',
      ],
    },
    {
      title: `Joining ${instanceName}`,
      body: [
        mode === 'invite'
          ? 'You need an invite code to open an account. Enter it on the sign-in screen, then ask for a link again.'
          : 'New accounts join through a waitlist. You can join it on the sign-in screen, and we’ll email you once you’re approved.',
        'If you did not ask to sign in, ignore this email.',
      ],
    },
    { url: appUrl, he: 'למסך הכניסה', en: 'Open the sign-in screen' },
  );
}

/** A moderator approved a waitlist entry (phase 21). */
export function waitlistApprovedEmail(
  instanceName: string,
  appUrl: string,
  days: number,
): Omit<MailMessage, 'to'> {
  return bilingualNotice(
    `${instanceName}: אפשר להצטרף / You're in`,
    {
      title: `אפשר להצטרף ל-${instanceName}`,
      body: [
        `הבקשה שלך אושרה. במהלך ${days} הימים הקרובים אפשר להיכנס עם כתובת המייל הזו ולפתוח חשבון.`,
      ],
    },
    {
      title: `You're in at ${instanceName}`,
      body: [
        `Your request was approved. In the next ${days} days you can sign in with this email address and open your account.`,
      ],
    },
    { url: appUrl, he: 'כניסה', en: 'Sign in' },
  );
}

/**
 * A new kind of device signed in (phase 32). Deliberately without a link: a real alert never asks
 * you to click, so this email can't be imitated for phishing. No IP address, no location.
 */
export function signinAlertEmail(
  instanceName: string,
  device: { he: string; en: string },
  at: Date,
): Omit<MailMessage, 'to'> {
  const when = (locale: string) =>
    `${at.toLocaleString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })} UTC`;
  return bilingualNotice(
    `${instanceName}: כניסה ממכשיר חדש / New sign-in`,
    {
      title: `כניסה חדשה לחשבון ב-${instanceName}`,
      body: [
        `מכשיר: ${device.he}. מתי: ${when('he-IL')}.`,
        'אם זה היה אצלך, אין צורך לעשות דבר.',
        'אם לא: באפליקציה, הגדרות ← אבטחה ← "ניתוק מכל שאר המכשירים", ובדיקה של חשבון האימייל. מייל אמיתי מאיתנו אף פעם לא מבקש ללחוץ על קישור.',
      ],
    },
    {
      title: `New sign-in to your ${instanceName} account`,
      body: [
        `Device: ${device.en}. When: ${when('en-GB')}.`,
        'If this was you, there’s nothing to do.',
        'If not: in the app, Settings → Security → “Sign out everywhere else”, and check your email account. A real email from us never asks you to click a link.',
      ],
    },
  );
}

/** Phase 41: sent to the NEW address; the only way to confirm a change of email. */
export function emailChangeConfirmEmail(
  instanceName: string,
  url: string,
  minutes: number,
): Omit<MailMessage, 'to'> {
  return bilingualNotice(
    `${instanceName}: אישור כתובת מייל / Confirm your email`,
    {
      title: 'אישור כתובת המייל החדשה',
      body: [
        `ביקשת לשנות את כתובת המייל של החשבון ב-${instanceName} לכתובת הזו.`,
        `הקישור תקף ל-${minutes} דקות. יש לפתוח אותו כשנכנסים לחשבון. אם לא ביקשת, אפשר להתעלם.`,
      ],
    },
    {
      title: 'Confirm your new email address',
      body: [
        `You asked to change your ${instanceName} account's email to this address.`,
        `The link works for ${minutes} minutes, while you're signed in. If you didn't ask, ignore this email.`,
      ],
    },
    { url, he: 'אישור הכתובת', en: 'Confirm this address' },
  );
}

/**
 * Phase 41: a heads-up to the OLD address, deliberately without a link (as the sign-in alert):
 * a real notice never asks you to click.
 */
export function emailChangeNoticeEmail(instanceName: string): Omit<MailMessage, 'to'> {
  return bilingualNotice(
    `${instanceName}: שינוי כתובת מייל / Email change requested`,
    {
      title: 'התבקש שינוי של כתובת המייל',
      body: [
        `מישהו שנכנס לחשבון שלך ב-${instanceName} ביקש להעביר אותו לכתובת מייל אחרת.`,
        'אם זה לא היית, יש להיכנס לאפליקציה, להתנתק מכל המכשירים האחרים (הגדרות ← אבטחה) ולבדוק את חשבון המייל.',
      ],
    },
    {
      title: 'An email change was requested',
      body: [
        `Someone signed in to your ${instanceName} account asked to move it to another email address.`,
        "If this wasn't you, open the app, sign out everywhere else (Settings → Security) and check your email account.",
      ],
    },
  );
}

/**
 * Phase 61: the member's appeal was decided. No outcome and no link in the email (as the sign-in
 * alert): the statement is read in the app, after signing in.
 */
export function appealDecidedEmail(instanceName: string): Omit<MailMessage, 'to'> {
  return bilingualNotice(
    `${instanceName}: הערעור שלך נבדק / Your appeal was reviewed`,
    {
      title: 'הערעור שלך נבדק',
      body: [
        `צוות ${instanceName} בדק את הערעור ששלחת על החלטה בנוגע לחשבון שלך.`,
        'התשובה מחכה באפליקציה, אחרי הכניסה לחשבון.',
      ],
    },
    {
      title: 'Your appeal was reviewed',
      body: [
        `The ${instanceName} team reviewed the appeal you sent about a decision on your account.`,
        'The answer is waiting in the app, after you sign in.',
      ],
    },
  );
}
