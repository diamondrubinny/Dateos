import type { Checkin, CheckinInput, ClosedConversation } from '@nexaheart/shared';
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

function useCheckinMutation<T>(fn: (arg: T) => Promise<unknown>) {
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
