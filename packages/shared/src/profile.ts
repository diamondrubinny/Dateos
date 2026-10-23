// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { accountNoticeSchema } from './moderation.js';
import { aboutSchema, accessNeedsSchema, dealbreakersSchema } from './about.js';
import { pauseStateSchema } from './visibility.js';
import { z } from 'zod';
import { publicIntegrationsSchema } from './integrations.js';
import { signupModes } from './trust.js';
import { localeSchema } from './common.js';

export const MIN_AGE = 18;
export const MAX_AGE = 100;
export const MAX_PHOTOS = 9;
export const MIN_PHOTOS = 1;
export const MAX_PROMPTS = 3;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export const genders = ['woman', 'man', 'nonbinary', 'other'] as const;
export const genderSchema = z.enum(genders);
export type Gender = z.infer<typeof genderSchema>;

export const intentions = ['long_term', 'short_term', 'open', 'friends', 'unsure'] as const;
export const intentionSchema = z.enum(intentions);
export type Intention = z.infer<typeof intentionSchema>;

/** Prompt catalogue keys; display text lives in client i18n files. */
export const promptKeys = [
  'perfect_sunday',
  'green_flag',
  'two_truths_one_lie',
  'geek_out_about',
  'best_travel_story',
  'first_date_idea',
  'simple_pleasures',
  'looking_for',
] as const;
export const promptKeySchema = z.enum(promptKeys);

/** Voice prompt (phase 19): one spoken answer to a prompt, at most this long. */
export const MAX_VOICE_PROMPT_SECONDS = 30;
export const voicePromptQuerySchema = z.object({
  promptKey: promptKeySchema,
  /** The app's language, for transcripts (phase 26). */
  lang: localeSchema.optional(),
});
/** As others see it: only once the clip is clean. */
export const voicePromptSchema = z.object({
  promptKey: promptKeySchema,
  audioId: z.uuid(),
  durationMs: z.number().int().nullable(),
});
export type VoicePrompt = z.infer<typeof voicePromptSchema>;
/** As the owner sees it, while it's being checked too. */
export const myVoicePromptSchema = voicePromptSchema.extend({
  status: z.enum(['quarantine', 'processing', 'clean', 'rejected']),
});

export type PromptKey = z.infer<typeof promptKeySchema>;

/**
 * `sensitive`: explicit consent to process gender and who someone is interested in, which can reveal
 * sexual orientation (GDPR Art. 9(2)(a); a "sensitive" type under Israel's Privacy Protection Law) ⚖️.
 */
export const consentKinds = [
  'terms',
  'privacy',
  'sensitive',
  'location',
  'ai_cloud',
  'analytics',
  /** Religious observance on the profile and as a filter (phase 19), GDPR Art. 9(2)(a) ⚖️. */
  'religion',
  /** Accessibility needs (phase 25): can reveal health data, GDPR Art. 9(2)(a) ⚖️. */
  'accessibility',
  /** Partner communities (phase 28b): a card, gender and who someone wants go to partners ⚖️. */
  'federation',
] as const;
export const consentKindSchema = z.enum(consentKinds);
export type ConsentKind = z.infer<typeof consentKindSchema>;
/** Consents the app cannot work without; the rest are optional and off by default. */
export const requiredConsents: readonly ConsentKind[] = ['terms', 'privacy', 'sensitive'];
/** Version of the in-app text for the `sensitive` consent; bump it when the wording changes. */
export const SENSITIVE_CONSENT_VERSION = '1';

export const photoStatuses = ['quarantine', 'processing', 'clean', 'rejected'] as const;
export type PhotoStatus = (typeof photoStatuses)[number];

export const allowedPhotoMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

/** Whole years between birth date and `today`, both as ISO dates (YYYY-MM-DD). */
export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

const isoDate = z.iso.date();

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const profileInputSchema = z.object({
  displayName: trimmed(40),
  /** Set once; later changes are rejected by the server. */
  birthDate: isoDate,
  gender: genderSchema,
  interestedIn: z.array(genderSchema).min(1).max(genders.length),
  intention: intentionSchema,
  bio: z.string().trim().max(500).optional(),
  languages: z
    .array(z.string().regex(/^[a-z]{2,3}$/))
    .max(10)
    .default([]),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const profileUpdateSchema = profileInputSchema.omit({ birthDate: true }).partial();
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const preferencesSchema = z
  .object({
    ageMin: z.number().int().min(MIN_AGE).max(MAX_AGE),
    ageMax: z.number().int().min(MIN_AGE).max(MAX_AGE),
    maxDistanceKm: z.number().int().min(1).max(500),
    intentions: z.array(intentionSchema).max(intentions.length),
  })
  .refine((p) => p.ageMin <= p.ageMax, { message: 'ageMin must be <= ageMax', path: ['ageMin'] });
export type Preferences = z.infer<typeof preferencesSchema>;

export const promptAnswerSchema = z.object({
  promptKey: promptKeySchema,
  answer: trimmed(300),
});
export const promptsInputSchema = z
  .array(promptAnswerSchema)
  .max(MAX_PROMPTS)
  .refine((items) => new Set(items.map((i) => i.promptKey)).size === items.length, {
    message: 'Each prompt can be answered once',
  });
export type PromptAnswer = z.infer<typeof promptAnswerSchema>;

export const consentInputSchema = z.object({
  kind: consentKindSchema,
  granted: z.boolean(),
  version: z.string().min(1).max(32),
});
export const consentsInputSchema = z
  .array(consentInputSchema)
  .min(1)
  .max(consentKinds.length)
  // One decision per kind per request, so the stored record is never ambiguous.
  .refine((items) => new Set(items.map((i) => i.kind)).size === items.length, {
    message: 'Each consent may appear only once.',
  });
export type ConsentInput = z.infer<typeof consentInputSchema>;

export const photoOrderSchema = z.object({ photoIds: z.array(z.uuid()).min(1).max(MAX_PHOTOS) });

export const photoSchema = z.object({
  id: z.uuid(),
  status: z.enum(photoStatuses),
  position: z.number().int(),
  url: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type Photo = z.infer<typeof photoSchema>;

// Consents come first: nothing sensitive is stored before the person has agreed to it.
export const onboardingSteps = ['consents', 'profile', 'photos', 'prompts', 'location'] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

export const meResponseSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), status: z.string() }),
  /** "Take a break" (phase 18a). */
  pause: pauseStateSchema,
  /** Only people I liked can see me (phase 18b). */
  incognito: z.boolean(),
  /** About me and dealbreakers (phase 19). */
  about: aboutSchema,
  dealbreakers: dealbreakersSchema,
  /** Accessibility needs (phase 25), by consent; `show` puts them on the profile. */
  accessNeeds: accessNeedsSchema,
  voicePrompt: myVoicePromptSchema.nullable(),
  /** Show the "met in person" badge (phase 20, off by default). */
  showMetBadge: z.boolean(),
  /** Show the "checked in at an event" badge (phase 23, off by default). */
  showEventBadge: z.boolean(),
  profile: profileInputSchema
    .extend({ bio: z.string().nullable(), age: z.number().int() })
    .nullable(),
  preferences: z
    .object({
      ageMin: z.number(),
      ageMax: z.number(),
      maxDistanceKm: z.number(),
      intentions: z.array(intentionSchema),
    })
    .nullable(),
  prompts: z.array(promptAnswerSchema),
  photos: z.array(photoSchema),
  consents: z.record(z.string(), z.boolean()),
  onboarding: z.object({ complete: z.boolean(), missing: z.array(z.enum(onboardingSteps)) }),
  verified: z.boolean(),
  notices: z.array(accountNoticeSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const instanceSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  primaryColor: z.string(),
  locales: z.array(z.string()),
  defaultLocale: z.string(),
  auth: z.object({
    magicLink: z.boolean(),
    google: z.boolean(),
    apple: z.boolean(),
    /** Sign in with a passkey (phase 21; the web app for now). */
    passkey: z.boolean(),
  }),
  sponsorUrl: z.string().nullable(),
  legal: z.object({ termsVersion: z.string(), privacyVersion: z.string() }),
  /** Contrast-checked brand colors for light and dark mode. */
  brand: z.object({
    light: z.object({ primary: z.string(), primarySoft: z.string() }),
    dark: z.object({ primary: z.string(), primarySoft: z.string() }),
  }),
  logoUrl: z.string().nullable(),
  /** Who runs this instance (shown in the legal pages and accessibility statement). */
  operatorName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  /** True until someone claims the instance with the setup token. */
  setupRequired: z.boolean(),
  /** Video dates are configured (LiveKit) and turned on by the community's admins. */
  calls: z.boolean(),
  /** Voice messages can be shown as text (phase 26), made on this community's server. */
  transcripts: z.boolean(),
  /** Who may open a new account (phase 21): open, with an invite code, or through a waitlist. */
  signup: z.enum(signupModes),
  /** What clients need from the integrations (phase 24): never a secret. */
  integrations: publicIntegrationsSchema,
  /** The software credit every interface shows (license term, see NOTICE). */
  poweredBy: z.object({
    name: z.literal('NexaHeart'),
    url: z.literal('https://nexaheart.com'),
    license: z.string(),
    sourceUrl: z.string(),
  }),
});
export type InstanceInfo = z.infer<typeof instanceSchema>;

// ---------------------------------------------------------------------------
// Profile Coach (phase 5)
// ---------------------------------------------------------------------------

export const coachTipIds = [
  'add_photos',
  'bio_missing',
  'bio_short',
  'bio_generic',
  'add_prompts',
  'prompt_short',
  'verify',
] as const;
export type CoachTipId = (typeof coachTipIds)[number];

export const coachResponseSchema = z.object({
  tips: z.array(z.object({ id: z.enum(coachTipIds) })),
  /** Bio ideas need an AI provider (and consent if it is external). */
  bioIdeas: z.enum(['available', 'needs_consent', 'unavailable']),
});
export type CoachResponse = z.infer<typeof coachResponseSchema>;

export const bioIdeasSchema = z.object({ ideas: z.array(z.string()) });
