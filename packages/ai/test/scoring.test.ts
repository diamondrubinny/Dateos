// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { rank, scoreCandidate, type CandidateSignals } from '../src/index.js';

const base: CandidateSignals = {
  vibeCosine: 0.2,
  embeddingModel: 'hashing-v1',
  viewerIntention: 'long_term',
  candidateIntention: 'long_term',
  viewerLanguages: ['he', 'en'],
  candidateLanguages: ['he'],
  distanceKm: 3,
  maxDistanceKm: 50,
  lastActiveDays: 0,
  accountAgeDays: 60,
  candidateLikes: 10,
  candidateDecisions: 20,
  candidateLikedViewer: false,
  impressions24h: 0,
};
const score = (over: Partial<CandidateSignals> = {}) => scoreCandidate({ ...base, ...over });

describe('scoreCandidate', () => {
  it('stays within 0–1000', () => {
    const best = score({ vibeCosine: 1, candidateLikedViewer: true, accountAgeDays: 1 });
    const worst = score({
      vibeCosine: -1,
      candidateIntention: 'friends',
      distanceKm: 500,
      lastActiveDays: 400,
      candidateLikes: 0,
      candidateDecisions: 500,
      impressions24h: 10_000,
    });
    expect(best.score).toBeLessThanOrEqual(1000);
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(best.score).toBeGreaterThan(worst.score);
  });

  it('prefers compatible intentions, closer people and similar vibes', () => {
    expect(score().score).toBeGreaterThan(score({ candidateIntention: 'short_term' }).score);
    expect(score().score).toBeGreaterThan(score({ distanceKm: 45 }).score);
    expect(score({ vibeCosine: 0.3 }).score).toBeGreaterThan(score({ vibeCosine: 0.02 }).score);
  });

  it('marriage (phase 62b) is closest to long-term, far from short-term', () => {
    const marriage = (candidateIntention: CandidateSignals['candidateIntention']) =>
      score({ viewerIntention: 'marriage', candidateIntention }).score;
    expect(marriage('marriage')).toBeGreaterThan(marriage('long_term'));
    expect(marriage('long_term')).toBeGreaterThan(marriage('open'));
    expect(marriage('open')).toBeGreaterThan(marriage('short_term'));
    expect(score({ candidateIntention: 'marriage' }).score).toBeGreaterThan(
      score({ candidateIntention: 'open' }).score,
    );
  });

  it('is reciprocal: people likely to like back rank higher', () => {
    expect(score({ candidateLikedViewer: true }).score).toBeGreaterThan(score().score);
    expect(score({ candidateLikes: 18, candidateDecisions: 20 }).score).toBeGreaterThan(
      score({ candidateLikes: 2, candidateDecisions: 20 }).score,
    );
  });

  it('never hides selective people entirely', () => {
    const choosy = score({ candidateLikes: 0, candidateDecisions: 1000 });
    expect(choosy.parts.reciprocity).toBeGreaterThanOrEqual(0.4);
    expect(choosy.score).toBeGreaterThan(0);
  });

  it('spreads attention: heavily shown profiles are dampened, newcomers get a small boost', () => {
    expect(score({ impressions24h: 200 }).score).toBeLessThan(score().score / 2);
    expect(score({ accountAgeDays: 2 }).score).toBeGreaterThan(score().score);
  });

  it('explains itself without ever revealing that someone liked you', () => {
    const { reasons } = score({ candidateLikedViewer: true, vibeCosine: 0.3 });
    expect(reasons).toContain('same_intention');
    expect(reasons.length).toBeLessThanOrEqual(3);
    expect(reasons as string[]).not.toContain('liked_you');
  });

  it('treats a missing embedding as neutral rather than bad', () => {
    expect(score({ vibeCosine: null }).parts.vibe).toBe(0.5);
  });
});

describe('rank', () => {
  it('orders by score with a stable tie-break', () => {
    const r = (userId: string, s: number) => ({ userId, result: { ...score(), score: s } });
    const items = [r('a', 10), r('b', 30), r('c', 10), r('d', 20)];
    const first = rank(items, '2026-10-21').map((i) => i.userId);
    expect(first.slice(0, 2)).toEqual(['b', 'd']);
    expect(rank([...items].reverse(), '2026-10-21').map((i) => i.userId)).toEqual(first);
  });
});

describe('shared interests (phase 19)', () => {
  it('nudge the score by up to 15% and show as a reason', () => {
    const none = scoreCandidate(base);
    const two = scoreCandidate({ ...base, sharedInterests: 2 });
    const many = scoreCandidate({ ...base, sharedInterests: 8 });
    expect(two.score).toBeGreaterThan(none.score);
    expect(many.parts.interests).toBeCloseTo(1.15);
    expect(none.reasons).not.toContain('shared_interests');
    expect(two.reasons).toContain('shared_interests');
  });
});
