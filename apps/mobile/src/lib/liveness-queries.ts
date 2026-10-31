// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { LivenessState } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import { chatKeys } from './realtime';

/** Phase 69: a live check through the community's provider. */
export function useLiveness() {
  return useQuery({
    queryKey: ['liveness'],
    queryFn: () => apiFetch<LivenessState>('/v1/me/liveness'),
  });
}

export function useStartLiveness() {
  return useMutation({
    mutationFn: () => apiFetch<{ url: string }>('/v1/me/liveness', { method: 'POST' }),
  });
}

/** Phase 69: ask a match kindly to verify (once per chat). */
export function useAskToVerify(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`/v1/matches/${matchId}/verify-request`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: chatKeys.messages(matchId) }),
  });
}
