// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * Phase 62a: gender identity and pronouns, beside the four matching genders (which searches use,
 * unchanged). Optional; special-category data (it can reveal orientation or a trans history), so
 * stored only with the `sensitive` consent, visible to matches only by default, never ranked on,
 * never sent to an AI model or to partner communities ⚖️. Keys, translated in the apps.
 */
export const genderIdentities = [
  'woman',
  'man',
  'trans_woman',
  'trans_man',
  'nonbinary',
  'genderqueer',
  'genderfluid',
  'agender',
  'bigender',
  'two_spirit',
  'intersex',
  'questioning',
] as const;
export type GenderIdentity = (typeof genderIdentities)[number];

/**
 * How to address me. Hebrew, Arabic and Russian inflect by gender, so this is a grammatical form
 * rather than an English pronoun: "she/her" in English, "פנייה בלשון נקבה" in Hebrew.
 */
export const addressForms = ['feminine', 'masculine', 'neutral', 'any'] as const;
export type AddressForm = (typeof addressForms)[number];

export const identityVisibilities = ['everyone', 'matches'] as const;
export type IdentityVisibility = (typeof identityVisibilities)[number];

/** What a community offers (Dashboard → Branding). */
export const identityVocabularies = ['basic', 'extended'] as const;
export type IdentityVocabulary = (typeof identityVocabularies)[number];

export const GENDER_CUSTOM_MIN = 2;
export const GENDER_CUSTOM_MAX = 30;

/** Own words: letters (any script), spaces, hyphen, apostrophe and slash. Plain text only. */
export const genderCustomSchema = z
  .string()
  .trim()
  .min(GENDER_CUSTOM_MIN)
  .max(GENDER_CUSTOM_MAX)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} '’\-/]*$/u, "Letters, spaces, - ' and / only");

export const identityInputSchema = z
  .object({
    genderIdentity: z.enum(genderIdentities).nullable(),
    genderCustom: genderCustomSchema.nullable(),
    pronouns: z.enum(addressForms).nullable(),
    visibility: z.enum(identityVisibilities).default('matches'),
  })
  .strict()
  .refine((i) => !(i.genderIdentity && i.genderCustom), {
    message: 'Choose from the list or use your own words, not both.',
    path: ['genderCustom'],
  });
export type IdentityInput = z.input<typeof identityInputSchema>;

/** As I see it on my own account. */
export const myIdentitySchema = z.object({
  genderIdentity: z.enum(genderIdentities).nullable(),
  genderCustom: z.string().nullable(),
  pronouns: z.enum(addressForms).nullable(),
  visibility: z.enum(identityVisibilities),
});
export type MyIdentity = z.infer<typeof myIdentitySchema>;
export const noIdentity: MyIdentity = {
  genderIdentity: null,
  genderCustom: null,
  pronouns: null,
  visibility: 'matches',
};

/** As others see it on a card (only what the member and the community allow), or null. */
export const publicIdentitySchema = z.object({
  genderIdentity: z.enum(genderIdentities).nullable(),
  genderCustom: z.string().nullable(),
  pronouns: z.enum(addressForms).nullable(),
});
export type PublicIdentity = z.infer<typeof publicIdentitySchema>;

/** The community's choices, in its public info. */
export const identitySettingsSchema = z.object({
  vocabulary: z.enum(identityVocabularies),
  customGender: z.boolean(),
  pronouns: z.boolean(),
});
export type IdentitySettings = z.infer<typeof identitySettingsSchema>;
export const defaultIdentitySettings: IdentitySettings = {
  vocabulary: 'extended',
  customGender: false,
  pronouns: true,
};

/**
 * What of a stored identity may be shown under the community's current settings (turning an
 * option off hides it at once; the stored value is kept).
 */
export function allowedIdentity(
  stored: Omit<MyIdentity, 'visibility'>,
  settings: IdentitySettings,
): PublicIdentity | null {
  const extended = settings.vocabulary === 'extended';
  const shown: PublicIdentity = {
    genderIdentity: extended ? stored.genderIdentity : null,
    genderCustom: extended && settings.customGender ? stored.genderCustom : null,
    pronouns: settings.pronouns ? stored.pronouns : null,
  };
  return shown.genderIdentity || shown.genderCustom || shown.pronouns ? shown : null;
}
