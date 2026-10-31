// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type {
  ConsoleQuery,
  IntroductionAnswer,
  IntroductionInput,
  IntroductionOutcome,
  IntroductionState,
  MatchmakerConsole,
  MyIntroductions,
} from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';
import { chatKeys } from './realtime';

/** Phase 68a: introductions by community matchmakers. */
export const introductionKeys = {
  mine: ['introductions'] as const,
  console: (q: ConsoleQuery) => ['matchmaker-console', q] as const,
};

export function useMyIntroductions() {
  return useQuery({
    queryKey: introductionKeys.mine,
    queryFn: () => apiFetch<MyIntroductions>('/v1/me/introductions'),
  });
}

export function useAnswerIntroduction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: IntroductionAnswer }) =>
      apiFetch<{ state: IntroductionState; matchId: string | null }>(
        `/v1/introductions/${id}/answer`,
        { method: 'PUT', body: json({ answer }) },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: introductionKeys.mine });
      void client.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });
}

export function useIntroductionOutcome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: IntroductionOutcome }) =>
      apiFetch(`/v1/introductions/${id}/outcome`, { method: 'PUT', body: json({ outcome }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: introductionKeys.mine }),
  });
}

export function useMatchmakerConsole(query: ConsoleQuery) {
  const params = new URLSearchParams(
    Object.entries(query).flatMap(([k, v]) =>
      v === undefined || v === '' ? [] : [[k, String(v)]],
    ),
  ).toString();
  return useQuery({
    queryKey: introductionKeys.console(query),
    queryFn: () =>
      apiFetch<MatchmakerConsole>(`/v1/introductions/console${params ? `?${params}` : ''}`),
  });
}

export function useIntroduce() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: IntroductionInput) =>
      apiFetch<{ id: string }>('/v1/introductions', { method: 'POST', body: json(input) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['matchmaker-console'] }),
  });
}
