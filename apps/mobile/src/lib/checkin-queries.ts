// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Checkin, CheckinExtend, CheckinInput, ClosedConversation } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';
import { chatKeys } from './realtime';

export const checkinKeys = {
  active: ['checkin', 'active'] as const,
  closed: ['matches', 'closed'] as const,
};

export function useActiveCheckin(enabled = true) {
  return useQuery({
    queryKey: checkinKeys.active,
    enabled,
    queryFn: async () =>
      (await apiFetch<{ checkin: Checkin | null }>('/v1/me/checkins/active')).checkin,
    // The status changes on the server when the check-in is missed.
    refetchInterval: 60_000,
  });
}

function useCheckinMutation<T, R = unknown>(fn: (arg: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: checkinKeys.active }),
  });
}

export const useCreateCheckin = () =>
  useCheckinMutation((input: CheckinInput) =>
    apiFetch<Checkin>('/v1/me/checkins', { method: 'POST', body: json(input) }),
  );
export const useCheckinOk = () =>
  useCheckinMutation((id: string) => apiFetch(`/v1/me/checkins/${id}/ok`, { method: 'POST' }));
export const useCheckinSos = () =>
  useCheckinMutation((id: string) => apiFetch(`/v1/me/checkins/${id}/sos`, { method: 'POST' }));
/** "Running late" (phase 45): move the check-in time later. */
export const useExtendCheckin = () =>
  useCheckinMutation(({ id, minutes }: { id: string } & CheckinExtend) =>
    apiFetch<Checkin>(`/v1/me/checkins/${id}/extend`, {
      method: 'POST',
      body: json({ minutes }),
    }),
  );
export const useCancelCheckin = () =>
  useCheckinMutation((id: string) => apiFetch(`/v1/me/checkins/${id}`, { method: 'DELETE' }));

export function useClosedConversations() {
  return useQuery({
    queryKey: checkinKeys.closed,
    queryFn: async () =>
      (await apiFetch<{ closed: ClosedConversation[] }>('/v1/matches/closed')).closed,
  });
}

export function useDismissClosed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string) =>
      apiFetch(`/v1/matches/${matchId}/closed/dismiss`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: checkinKeys.closed }),
  });
}

export function useCloseKindly(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (message: string) =>
      apiFetch(`/v1/matches/${matchId}/close`, { method: 'POST', body: json({ message }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: chatKeys.conversations }),
  });
}
