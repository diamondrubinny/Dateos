import type { Locale } from './common.js';

export interface CheckinAlert {
  instanceName: string;
  memberName: string;
  contactName: string;
  matchName: string | null;
  place: string;
  note: string | null;
  startsAt: Date;
  checkAt: Date;
  locale: Locale;
  timeZone: string;
  sos: boolean;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Member text goes into an email: no line breaks that could fake headers or structure. */
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim();

const TEXT: Record<
  Locale,
  {
    subjectMissed: string;
    subjectSos: string;
    hello: string;
    missed: string;
    sos: string;
    shared: string;
    place: string;
    time: string;
    meeting: string;
    note: string;
    call: string;
    footer: string;
  }
> = {
  en: {
    subjectMissed: '{instance}: {member} did not check in after a date',
    subjectSos: 'URGENT: {member} asked for help (SOS)',
    hello: 'Hi {contact},',
    missed:
      '{member} added you as a trusted contact for a date and did not confirm being OK by {checkAt}.',
    sos: '{member} added you as a trusted contact for a date and just pressed the SOS button.',
    shared: 'What {member} shared with you:',
    place: 'Place',
    time: 'Time',
    meeting: 'Meeting',
    note: 'Note',
    call: 'Please try to call {member}. If you think they are in danger, call your local emergency number.',
    footer:
      'This email was sent by {instance}, a dating community, because {member} chose you as a trusted contact. We will not contact you again about this date.',
  },
  he: {
    subjectMissed: '{instance}: {member} לא אישר/ה שהכול בסדר אחרי דייט',
    subjectSos: 'דחוף: {member} ביקש/ה עזרה (SOS)',
    hello: 'שלום {contact},',
    missed: '{member} הוסיף/ה אותך כאיש/אשת קשר בטוח/ה לדייט ולא אישר/ה שהכול בסדר עד {checkAt}.',
    sos: '{member} הוסיף/ה אותך כאיש/אשת קשר בטוח/ה לדייט ולחץ/ה עכשיו על כפתור ה-SOS.',
    shared: 'מה ש{member} שיתף/ה איתך:',
    place: 'מקום',
    time: 'זמן',
    meeting: 'עם מי',
    note: 'הערה',
    call: 'כדאי לנסות להתקשר אל {member}. אם נראה לך שיש סכנה, יש להתקשר למספר החירום המקומי.',
    footer:
      'המייל נשלח מ-{instance}, קהילת היכרויות, כי {member} בחר/ה בך כאיש/אשת קשר בטוח/ה. לא נפנה אליך שוב בנוגע לדייט הזה.',
  },
  ar: {
    subjectMissed: '{instance}: لا تأكيد بالسلامة من {member} بعد موعد',
    subjectSos: 'عاجل: طلب مساعدة (SOS) من {member}',
    hello: 'مرحبًا {contact}،',
    missed:
      'أنت جهة الاتصال الموثوقة لدى {member} في موعد، ولم يصلنا تأكيد بالسلامة حتى {checkAt}.',
    sos: 'أنت جهة الاتصال الموثوقة لدى {member} في موعد، وقد ضُغط الآن على زر الاستغاثة SOS.',
    shared: 'ما شاركه {member} معك:',
    place: 'المكان',
    time: 'الوقت',
    meeting: 'مع',
    note: 'ملاحظة',
    call: 'يُرجى محاولة الاتصال بـ{member}. إذا كنت تعتقد بوجود خطر، فاتصل برقم الطوارئ المحلي.',
    footer:
      'أُرسلت هذه الرسالة من {instance}، وهو مجتمع للتعارف، لأنك جهة الاتصال الموثوقة لدى {member}. لن نتواصل معك مجددًا بشأن هذا الموعد.',
  },
  ru: {
    subjectMissed: '{instance}: {member} не отметился после свидания',
    subjectSos: 'СРОЧНО: {member} просит о помощи (SOS)',
    hello: 'Здравствуйте, {contact}!',
    missed:
      '{member} указал(а) вас как доверенный контакт на время свидания и не подтвердил(а), что всё в порядке, до {checkAt}.',
    sos: '{member} указал(а) вас как доверенный контакт на время свидания и только что нажал(а) кнопку SOS.',
    shared: 'Что {member} сообщил(а) вам:',
    place: 'Место',
    time: 'Время',
    meeting: 'Встреча с',
    note: 'Заметка',
    call: 'Пожалуйста, попробуйте позвонить: {member}. Если вы считаете, что есть опасность, звоните в местную службу экстренной помощи.',
    footer:
      'Это письмо отправил {instance}, сообщество знакомств, потому что {member} выбрал(а) вас доверенным контактом. Мы больше не будем писать вам об этом свидании.',
  },
};

/** The email a trusted contact gets: the member's own words, quoted plainly, no links. */
export function checkinAlertEmail(a: CheckinAlert): {
  subject: string;
  text: string;
  html: string;
} {
  const t = TEXT[a.locale];
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(a.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: a.timeZone,
    }).format(d);
  const fill = (s: string) =>
    s
      .replace(/\{instance\}/g, oneLine(a.instanceName))
      .replace(/\{member\}/g, oneLine(a.memberName))
      .replace(/\{contact\}/g, oneLine(a.contactName))
      .replace(/\{checkAt\}/g, fmt(a.checkAt));
  const rows: [string, string][] = [
    [t.place, oneLine(a.place)],
    [t.time, `${fmt(a.startsAt)} – ${fmt(a.checkAt)}`],
    ...(a.matchName ? ([[t.meeting, oneLine(a.matchName)]] as [string, string][]) : []),
    ...(a.note ? ([[t.note, oneLine(a.note)]] as [string, string][]) : []),
  ];
  const lead = fill(a.sos ? t.sos : t.missed);
  const subject = fill(a.sos ? t.subjectSos : t.subjectMissed);
  const text = [
    fill(t.hello),
    '',
    lead,
    '',
    fill(t.shared),
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    fill(t.call),
    '',
    fill(t.footer),
  ].join('\n');
  const dir = a.locale === 'he' || a.locale === 'ar' ? 'rtl' : 'ltr';
  const html =
    `<div dir="${dir}" style="font-family:sans-serif;line-height:1.5">` +
    `<p>${escapeHtml(fill(t.hello))}</p>` +
    `<p><strong>${escapeHtml(lead)}</strong></p>` +
    `<p>${escapeHtml(fill(t.shared))}</p><ul>` +
    rows.map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(v)}</li>`).join('') +
    `</ul><p>${escapeHtml(fill(t.call))}</p>` +
    `<p style="color:#555;font-size:13px">${escapeHtml(fill(t.footer))}</p></div>`;
  return { subject, text, html };
}
