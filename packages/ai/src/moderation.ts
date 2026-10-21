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
function prepare(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0591-\u05C7\u0300-\u036F]/g, '')
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .replace(/(\p{L})\1{2,}/gu, '$1');
}

function finish(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeForModeration(text: string): string {
  return finish(prepare(text));
}

/** Hebrew words can carry one-letter prefixes (ו/ה/ש/ב/ל/מ/כ), e.g. "והמטומטם". */
const HE_PREFIX = '(?:[והשבלמכ]{0,2})';

/** Every word that appears in a harm phrase: candidates for undoing masks like "f*ck". */
const HARM_WORDS = new Set<string>();

function lexicon(en: string[], he: string[], collect = false): RegExp {
  if (collect) {
    for (const phrase of [...en, ...he])
      for (const word of phrase.split(' ')) if (word.length >= 3) HARM_WORDS.add(word);
  }
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
    true,
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
    true,
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
    true,
  ),
};

const MASK = /[*#•]/u;
const SEPARATED = /^(?:\p{L}[.\-_·])+\p{L}[.\-_·]?$/u;

/** "f*ck" → "fuck" when exactly one harm word fits; otherwise the token is left alone. */
function unmaskToken(token: string): string {
  const core = token.replace(/^[^\p{L}*#•]+|[^\p{L}*#•]+$/gu, '');
  if (SEPARATED.test(core)) return core.replace(/[.\-_·]/g, ''); // i.d.i.o.t
  if (!MASK.test(core) || !/^\p{L}/u.test(core)) return token;
  const chars = [...core];
  const letters = chars.filter((c) => /\p{L}/u.test(c)).length;
  if (letters < 2 || letters < chars.length / 2) return token;
  const fits = [...HARM_WORDS].filter((word) => {
    const w = [...word];
    return w.length === chars.length && chars.every((c, i) => MASK.test(c) || c === w[i]);
  });
  return fits.length === 1 ? fits[0]! : token;
}

/** Joins runs of 3+ single letters: "i d i o t" → "idiot", "ז ו נ ה" → "זונה". */
function joinSpacedLetters(text: string): string {
  return text.replace(/(?<!\p{L})\p{L}(?: \p{L}){2,}(?!\p{L})/gu, (run) => run.replace(/ /g, ''));
}

/** Text prepared for harm rules: masks and spaced-out letters undone. */
export function revealMaskedWords(text: string): string {
  const unmasked = prepare(text).split(/\s+/).map(unmaskToken).join(' ');
  return joinSpacedLetters(finish(unmasked));
}

export function checkHarm(text: string): HarmResult {
  const normalized = revealMaskedWords(text);
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
/** "@handle" style usernames and the apps people use to move a chat elsewhere. */
const HANDLE = /(?<![\p{L}\p{N}._])@[\p{L}\p{N}_.]{2,}/u;
const CONTACT_APPS =
  /\b(?:instagram|insta|ig|telegram|whatsapp|snapchat|snap|tiktok|facebook|messenger|signal|wechat|kik|onlyfans)\b|אינסטגרם|אינסטה|טלגרם|וואטסאפ|ווטסאפ|סנאפ|טיקטוק|פייסבוק/iu;

/** Links, emails, phone numbers, handles or messaging apps: never allowed in generated text. */
export function containsContactOrLink(text: string): boolean {
  return (
    LINK.test(text) ||
    PHONE.test(text) ||
    /\S+@\S+\.\S+/.test(text) ||
    HANDLE.test(text) ||
    CONTACT_APPS.test(text)
  );
}

/**
 * Text that reads like instructions to a model (prompt-injection residue). Generated text that
 * echoes such phrases is discarded, even when it came from the person's own profile.
 */
const INSTRUCTION = new RegExp(
  [
    '\\bignore\\s+(?:(?:all|any|the|your|my)\\s+)*(?:(?:previous|prior|above|earlier)\\s+)?(?:instructions|prompts|messages|rules)\\b',
    '\\bsystem\\s+prompt\\b',
    '\\bnew\\s+instructions\\b',
    '\\bas an ai\\b',
    '\\blanguage model\\b',
    '\\bdisregard\\s+(?:all|the|previous|your)\\b',
    '(?:התעלם|התעלמ[וי]|תתעלמ[וי]?)\\s+מ(?:כל\\s+)?ה?הוראות',
    'הוראות\\s+(?:קודמות|חדשות)',
    'פרומפט',
  ].join('|'),
  'iu',
);

export function looksLikeInstructions(text: string): boolean {
  return INSTRUCTION.test(text);
}
