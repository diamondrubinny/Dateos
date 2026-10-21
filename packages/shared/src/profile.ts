import { accountNoticeSchema } from './moderation.js';
import { z } from 'zod';

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
export type PromptKey = z.infer<typeof promptKeySchema>;

export const consentKinds = ['terms', 'privacy', 'location', 'ai_cloud', 'analytics'] as const;
export const consentKindSchema = z.enum(consentKinds);
export type ConsentKind = z.infer<typeof consentKindSchema>;
/** Consents the app cannot work without; the rest are optional and off by default. */
export const requiredConsents: readonly ConsentKind[] = ['terms', 'privacy'];

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
export const consentsInputSchema = z.array(consentInputSchema).min(1).max(consentKinds.length);
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

export const onboardingSteps = ['profile', 'consents', 'photos', 'prompts', 'location'] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

export const meResponseSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), status: z.string() }),
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
  auth: z.object({ magicLink: z.boolean(), google: z.boolean(), apple: z.boolean() }),
  sponsorUrl: z.string().nullable(),
  legal: z.object({ termsVersion: z.string(), privacyVersion: z.string() }),
});
export type InstanceInfo = z.infer<typeof instanceSchema>;
