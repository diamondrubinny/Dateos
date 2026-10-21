/**
 * Local, explainable message checks (English + Hebrew). Lexicon and pattern based on purpose:
 * no message text leaves the server, results are predictable, and every rule can be reviewed.
 * This is a safety net, not a guarantee; human moderation (phase 4) handles what it misses.
 */

export type HarmCategory = 'insult' | 'sexual' | 'threat';
export type ScamSignal = 'money' | 'crypto' | 'gift_card' | 'off_platform' | 'link';

export interface HarmResult {
  flagged: boolean;
  categories: HarmCategory[];
}

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/** Lowercase, drop diacritics and Hebrew niqqud, undo leetspeak, squeeze repeats ("fuuuck" → "fuck"). */
export function normalizeForModeration(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[֑-ׇ̀-ͯ]/g, '')
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .replace(/(\p{L})\1{2,}/gu, '$1')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hebrew words can carry one-letter prefixes (ו/ה/ש/ב/ל/מ/כ), e.g. "והמטומטם". */
const HE_PREFIX = '(?:[והשבלמכ]{0,2})';

function lexicon(en: string[], he: string[]): RegExp {
  const enPart = en.map((w) => w.replace(/ /g, '\\s+')).join('|');
  const hePart = he.map((w) => w.replace(/ /g, '\\s+')).join('|');
  return new RegExp(`(?<![\\p{L}])(?:(?:${enPart})|${HE_PREFIX}(?:${hePart}))(?![\\p{L}])`, 'u');
}

const RULES: Record<HarmCategory, RegExp> = {
  insult: lexicon(
    [
      'idiot',
      'stupid bitch',
      'bitch',
      'slut',
      'whore',
      'cunt',
      'retard',
      'fuck you',
      'fuck off',
      'piece of shit',
      'ugly cow',
      'you are ugly',
      'youre ugly',
      "you're ugly",
      'fat pig',
    ],
    [
      'מטומטם',
      'מטומטמת',
      'אידיוט',
      'אידיוטית',
      'זונה',
      'שרמוטה',
      'כוס אמק',
      'כוסאמק',
      'מכוערת',
      'מכוער',
      'דפוקה',
      'סתמי את הפה',
      'סתום את הפה',
      'חתיכת חרא',
      'בהמה',
    ],
  ),
  sexual: lexicon(
    [
      'send nudes',
      'nudes',
      'send pics of your body',
      'dick pic',
      'wanna fuck',
      'want to fuck',
      'sit on my face',
      'show me your tits',
      'show me your boobs',
      'suck my',
    ],
    [
      'תשלחי עירום',
      'תמונות עירום',
      'עירום',
      'בא לי לזיין',
      'לזיין אותך',
      'תראי לי ציצים',
      'ציצים',
      'תמצצי',
      'זין שלי',
      'חרמן',
      'חרמנית',
    ],
  ),
  threat: lexicon(
    [
      'i will kill you',
      "i'll kill you",
      'ill kill you',
      'i know where you live',
      "i'll find you",
      'ill find you',
      'you will regret',
      "you'll regret this",
      'watch your back',
    ],
    [
      'אני ארצח אותך',
      'ארצח אותך',
      'אהרוג אותך',
      'אני אהרוג אותך',
      'אני יודע איפה את גרה',
      'אני אמצא אותך',
      'אמצא אותך',
      'את תצטערי',
      'תיזהרי ממני',
    ],
  ),
};

export function checkHarm(text: string): HarmResult {
  const normalized = normalizeForModeration(text);
  const categories = (Object.keys(RULES) as HarmCategory[]).filter((c) =>
    RULES[c].test(normalized),
  );
  return { flagged: categories.length > 0, categories };
}

const SCAM_RULES: Record<Exclude<ScamSignal, 'off_platform' | 'link'>, RegExp> = {
  money: lexicon(
    [
      'send me money',
      'send money',
      'wire me',
      'wire transfer',
      'western union',
      'moneygram',
      'bank transfer',
      'lend me',
      'loan me',
      'need money',
      'pay for my ticket',
      'paypal me',
      'cash app',
      'venmo me',
    ],
    [
      'תעביר לי כסף',
      'תעבירי לי כסף',
      'להעביר כסף',
      'העברה בנקאית',
      'תלווה לי',
      'תלווי לי',
      'הלוואה',
      'צריך כסף',
      'צריכה כסף',
      'בביט',
      'בפייבוקס',
      'תשלח לי בביט',
    ],
  ),
  crypto: lexicon(
    [
      'bitcoin',
      'btc',
      'crypto',
      'usdt',
      'ethereum',
      'investment platform',
      'trading platform',
      'guaranteed profit',
      'forex',
    ],
    ['ביטקוין', 'קריפטו', 'פלטפורמת השקעות', 'רווח מובטח', 'מסחר במטבעות', 'פורקס'],
  ),
  gift_card: lexicon(
    ['gift card', 'itunes card', 'google play card', 'steam card', 'amazon card'],
    ['כרטיס מתנה', 'גיפט קארד', 'תו קנייה'],
  ),
};

const OFF_PLATFORM = lexicon(
  [
    'whatsapp',
    'telegram',
    'signal me',
    'snapchat',
    'snap me',
    'text me at',
    'call me at',
    'my number is',
    'add me on',
  ],
  ['וואטסאפ', 'ווטסאפ', 'וטסאפ', 'טלגרם', 'סנאפ', 'תתקשרי אליי', 'המספר שלי'],
);
const PHONE = /(?:\+?\d[\d\s-]{7,}\d)/;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|me|co|ly|xyz|il)\b/i;

/**
 * Signals shown to the *receiver* as a gentle safety banner. Moving to another app is only a
 * signal early in a conversation, when scammers typically push for it.
 */
export function detectScamSignals(text: string, messagesSoFar: number): ScamSignal[] {
  const normalized = normalizeForModeration(text);
  const signals: ScamSignal[] = [];
  for (const [signal, rule] of Object.entries(SCAM_RULES) as [ScamSignal, RegExp][]) {
    if (rule.test(normalized)) signals.push(signal);
  }
  if (messagesSoFar < 10 && (OFF_PLATFORM.test(normalized) || PHONE.test(text)))
    signals.push('off_platform');
  if (LINK.test(text)) signals.push('link');
  return signals;
}

/** Removes things an AI suggestion must never contain. */
export function containsContactOrLink(text: string): boolean {
  return LINK.test(text) || PHONE.test(text) || /\S+@\S+\.\S+/.test(text);
}
