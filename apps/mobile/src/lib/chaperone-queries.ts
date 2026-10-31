// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { ChaperoneTranscript, Chaperoning, MyChaperone } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';
import { webUrl } from './config';

/** Phase 68d: a chaperone the member chooses. */
const mine = ['my-chaperone'] as const;
const theirs = ['chaperoning'] as const;

export const chaperoneUrl = (token: string) => `${webUrl()}/chaperone/${token}`;

export function useMyChaperone() {
  return useQuery({ queryKey: mine, queryFn: () => apiFetch<MyChaperone>('/v1/me/chaperone') });
}

export function useInviteChaperone() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ token: string; expiresAt: string }>('/v1/me/chaperone/link', { method: 'POST' }),
  });
}

export function useRemoveChaperone() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/v1/me/chaperone', { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: mine }),
  });
}

export function useChaperoneLink(token: string) {
  return useQuery({
    queryKey: ['chaperone-link', token],
    queryFn: () => apiFetch<{ memberName: string }>(`/v1/chaperone/links/${token}`),
    retry: false,
  });
}

export function useJoinAsChaperone() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch('/v1/chaperone/join', { method: 'POST', body: json({ token }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: theirs }),
  });
}

export function useChaperoning() {
  return useQuery({ queryKey: theirs, queryFn: () => apiFetch<Chaperoning>('/v1/chaperoning') });
}

export function useStepDown() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => apiFetch(`/v1/chaperoning/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: theirs }),
  });
}

export function useTranscript(memberId: string, matchId: string) {
  return useQuery({
    queryKey: ['chaperone-transcript', memberId, matchId],
    queryFn: () => apiFetch<ChaperoneTranscript>(`/v1/chaperoning/${memberId}/${matchId}`),
    retry: false,
  });
}
