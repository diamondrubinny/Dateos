// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { ResumeCard, ResumeLink, ResumeLinkInput } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';
import { webUrl } from './config';

/** Phase 68b: my matchmaking résumé links. */
const key = ['resume-links'] as const;

export const resumeUrl = (token: string) => `${webUrl()}/resume/${token}`;

export function useResumeLinks() {
  return useQuery({
    queryKey: key,
    queryFn: async () => (await apiFetch<{ links: ResumeLink[] }>('/v1/me/resume-links')).links,
  });
}

export function useCreateResumeLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ResumeLinkInput) =>
      apiFetch<ResumeLink & { token: string }>('/v1/me/resume-links', {
        method: 'POST',
        body: json(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
}

export function useEndResumeLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/me/resume-links/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
}

/** The public page (no sign-in). */
export function useResumeCard(token: string) {
  return useQuery({
    queryKey: ['resume-card', token],
    queryFn: () => apiFetch<ResumeCard>(`/v1/resume/${token}`),
    retry: false,
    staleTime: Infinity,
  });
}
