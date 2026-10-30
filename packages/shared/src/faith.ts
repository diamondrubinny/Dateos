// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * Phase 62b: a faith module a community can turn on. Special-category data (GDPR Art. 9; sensitive
 * under Israel's privacy law): stored only with the `religion` consent, never ranked on, never sent
 * to an AI model or to partner communities; used only as filters the member chooses ⚖️.
 * Keys only; the apps translate them.
 */
export const faiths = [
  'jewish',
  'muslim',
  'christian',
  'druze',
  'buddhist',
  'hindu',
  'spiritual',
  'none',
  'other',
] as const;
export type Faith = (typeof faiths)[number];

/** Streams, for the faiths that have them in this list. */
export const faithStreams = {
  jewish: [
    'secular',
    'traditional',
    'dati_leumi',
    'torani',
    'haredi',
    'chabad',
    'conservative',
    'reform',
  ],
  muslim: ['sunni', 'shia', 'other_muslim'],
  christian: ['catholic', 'orthodox', 'protestant', 'other_christian'],
} as const satisfies Partial<Record<Faith, readonly string[]>>;
export const allStreams = [
  ...faithStreams.jewish,
  ...faithStreams.muslim,
  ...faithStreams.christian,
] as const;
export type FaithStream = (typeof allStreams)[number];

/** Observance questions, each answered yes / partly / no; only those that fit the faith. */
export const observanceQuestions = [
  'shabbat',
  'kashrut',
  'negiah',
  'halal',
  'prayer',
  'services',
] as const;
export type ObservanceQuestion = (typeof observanceQuestions)[number];
export const observanceAnswers = ['yes', 'partly', 'no'] as const;
export type ObservanceAnswer = (typeof observanceAnswers)[number];
export const faithQuestions: Partial<Record<Faith, readonly ObservanceQuestion[]>> = {
  jewish: ['shabbat', 'kashrut', 'negiah'],
  muslim: ['halal', 'prayer'],
  christian: ['services'],
  druze: ['prayer'],
};

export function streamsFor(faith: Faith | null): readonly FaithStream[] {
  return faith && faith in faithStreams ? faithStreams[faith as keyof typeof faithStreams] : [];
}
export function questionsFor(faith: Faith | null): readonly ObservanceQuestion[] {
  return (faith && faithQuestions[faith]) ?? [];
}

export const faithInputSchema = z
  .object({
    faith: z.enum(faiths).nullable(),
    stream: z.enum(allStreams).nullable(),
    observance: z.partialRecord(z.enum(observanceQuestions), z.enum(observanceAnswers)),
  })
  .strict()
  .refine((f) => f.stream === null || streamsFor(f.faith).includes(f.stream), {
    message: 'This stream doesn’t belong to that faith.',
    path: ['stream'],
  })
  .refine(
    (f) =>
      (Object.keys(f.observance) as ObservanceQuestion[]).every((q) =>
        questionsFor(f.faith).includes(q),
      ),
    { message: 'These questions don’t belong to that faith.', path: ['observance'] },
  );
export type FaithInput = z.infer<typeof faithInputSchema>;
export const faithSchema = z.object({
  faith: z.enum(faiths).nullable(),
  stream: z.enum(allStreams).nullable(),
  observance: z.partialRecord(z.enum(observanceQuestions), z.enum(observanceAnswers)),
});
export type FaithAnswers = z.infer<typeof faithSchema>;
export const noFaith: FaithAnswers = { faith: null, stream: null, observance: {} };

/** Version of the in-app text for the faith module (shares the `religion` consent). */
export const FAITH_MODULE_VERSION = '1';
