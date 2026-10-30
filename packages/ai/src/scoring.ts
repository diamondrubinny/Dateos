// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Intention, ReasonCode } from '@nexaheart/shared';

/**
 * Reciprocal, explainable ranking. The full method is documented in docs/MATCHING.md.
 * Deliberately NOT used: attractiveness, "desirability" scores (Elo), photos, ethnicity,
 * religion or any other protected trait. Those may only appear as filters a user chooses.
 */

export interface CandidateSignals {
  /** Cosine similarity of profile embeddings from the same model, or null if missing. */
  vibeCosine: number | null;
  embeddingModel: string | null;
  viewerIntention: Intention;
  candidateIntention: Intention;
  viewerLanguages: string[];
  candidateLanguages: string[];
  distanceKm: number;
  maxDistanceKm: number;
  /** Days since the candidate was last active, or null if unknown. */
  lastActiveDays: number | null;
  accountAgeDays: number;
  /** Candidate's own likes and total decisions in the last 30 days. */
  candidateLikes: number;
  candidateDecisions: number;
  /** The candidate already liked the viewer (boosts ranking, never shown as a reason). */
  candidateLikedViewer: boolean;
  /** Times the candidate was shown to anyone in the last 24 hours. */
  impressions24h: number;
  /** Interests both people picked (phase 19). */
  sharedInterests?: number;
}

export interface ScoreResult {
  /** 0–1000, higher is better. */
  score: number;
  reasons: ReasonCode[];
  parts: Record<
    | 'vibe'
    | 'intention'
    | 'distance'
    | 'language'
    | 'activity'
    | 'interests'
    | 'reciprocity'
    | 'fairness',
    number
  >;
}

export const WEIGHTS = {
  vibe: 0.3,
  intention: 0.25,
  distance: 0.15,
  language: 0.1,
  activity: 0.2,
} as const;

/** Symmetric compatibility of what two people are looking for. */
const INTENTION: Record<Intention, Record<Intention, number>> = {
  long_term: { long_term: 1, marriage: 0.9, open: 0.7, unsure: 0.6, short_term: 0.2, friends: 0.2 },
  // Phase 62b: marriage is closest to long-term.
  marriage: { marriage: 1, long_term: 0.9, unsure: 0.5, open: 0.4, short_term: 0.1, friends: 0.2 },
  short_term: {
    short_term: 1,
    open: 0.8,
    unsure: 0.5,
    long_term: 0.2,
    marriage: 0.1,
    friends: 0.3,
  },
  open: { open: 1, long_term: 0.7, marriage: 0.4, short_term: 0.8, friends: 0.6, unsure: 0.7 },
  friends: { friends: 1, open: 0.6, unsure: 0.4, long_term: 0.2, marriage: 0.2, short_term: 0.3 },
  unsure: { unsure: 0.8, long_term: 0.6, marriage: 0.5, short_term: 0.5, open: 0.7, friends: 0.4 },
};

/** Typical cosine range per embedding family, so lexical and semantic scores are comparable. */
function calibrate(cosine: number, model: string | null): number {
  const [lo, hi] = model?.startsWith('ollama:') ? [0.2, 0.85] : [0, 0.35];
  return Math.min(1, Math.max(0, (cosine - lo) / (hi - lo)));
}

function activityScore(days: number | null): number {
  if (days === null) return 0.3;
  if (days <= 1) return 1;
  if (days <= 7) return 0.7;
  if (days <= 30) return 0.4;
  return 0.1;
}

export function scoreCandidate(s: CandidateSignals): ScoreResult {
  const vibe = s.vibeCosine === null ? 0.5 : calibrate(s.vibeCosine, s.embeddingModel);
  const intention = INTENTION[s.viewerIntention][s.candidateIntention];
  const distance = 1 - 0.8 * Math.min(1, s.distanceKm / Math.max(1, s.maxDistanceKm));
  const sharedLanguages = s.viewerLanguages.filter((l) => s.candidateLanguages.includes(l));
  const language =
    s.viewerLanguages.length === 0 || s.candidateLanguages.length === 0
      ? 0.6
      : sharedLanguages.length > 0
        ? 1
        : 0.3;
  const activity = activityScore(s.lastActiveDays);

  // Shared interests (phase 19) add up to 15% on top: a nudge, never a filter.
  const shared = Math.min(3, s.sharedInterests ?? 0);
  const interests = 1 + 0.05 * shared;
  const compatibility =
    (WEIGHTS.vibe * vibe +
      WEIGHTS.intention * intention +
      WEIGHTS.distance * distance +
      WEIGHTS.language * language +
      WEIGHTS.activity * activity) *
    interests;

  // Reciprocity: how likely the other person is to like back. Laplace-smoothed like rate,
  // or near-certain if they already liked the viewer. Selective people are not penalised
  // below 0.4, so being choosy never hides anyone completely.
  const likeRate = (s.candidateLikes + 1) / (s.candidateDecisions + 2);
  const pLikeBack = s.candidateLikedViewer ? 0.95 : likeRate;
  const reciprocity = 0.4 + 0.6 * pLikeBack;

  // Fairness: spread attention instead of sending everyone to the same few profiles,
  // and give new members a fair first week.
  const exposure = 1 / (1 + s.impressions24h / 20);
  const newcomer = s.accountAgeDays < 7 ? 1.1 : 1;
  const fairness = exposure * newcomer;

  const score = Math.round(Math.min(1, compatibility * reciprocity * fairness) * 1000);

  const candidates: [ReasonCode, number][] = [];
  if (s.viewerIntention === s.candidateIntention)
    candidates.push(['same_intention', WEIGHTS.intention]);
  if (vibe >= 0.6 && s.vibeCosine !== null) candidates.push(['similar_vibe', WEIGHTS.vibe * vibe]);
  if (sharedLanguages.length > 0) candidates.push(['shared_language', WEIGHTS.language]);
  if (shared > 0) candidates.push(['shared_interests', 0.08 + 0.04 * shared]);
  if (s.distanceKm < 5) candidates.push(['nearby', WEIGHTS.distance * distance]);
  if (s.lastActiveDays !== null && s.lastActiveDays <= 1)
    candidates.push(['active_recently', WEIGHTS.activity * 0.5]);
  if (s.accountAgeDays < 7) candidates.push(['new_here', 0.01]);
  const reasons = candidates
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code]) => code);

  return {
    score,
    reasons,
    parts: { vibe, intention, distance, language, activity, interests, reciprocity, fairness },
  };
}

/** Highest score first; ties broken by a stable per-day key so lists don't reshuffle on reload. */
export function rank<T extends { userId: string; result: ScoreResult }>(
  items: T[],
  seed: string,
): T[] {
  const tie = (id: string) => {
    let h = 0;
    for (const c of `${seed}:${id}`) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
    return h;
  };
  return [...items].sort(
    (a, b) => b.result.score - a.result.score || tie(a.userId) - tie(b.userId),
  );
}
