import type { CallJoin, CallView } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';
import { settingsKey } from './chat-queries';
import { chatKeys } from './realtime';

export const callKey = (id: string) => ['call', id] as const;

export function useCall(id: string) {
  return useQuery({ queryKey: callKey(id), queryFn: () => apiFetch<CallView>(`/v1/calls/${id}`) });
}

export function useStartCall(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (video: boolean) =>
      apiFetch<CallView>(`/v1/matches/${matchId}/calls`, { method: 'POST', body: json({ video }) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: chatKeys.messages(matchId) }),
  });
}

/** A short-lived token for this call's room (asked for again on every join). */
export const joinCall = (id: string) =>
  apiFetch<CallJoin>(`/v1/calls/${id}/join`, { method: 'POST' });
export const declineCall = (id: string) =>
  apiFetch<CallView>(`/v1/calls/${id}/decline`, { method: 'POST' });
export const endCall = (id: string) =>
  apiFetch<CallView>(`/v1/calls/${id}/end`, { method: 'POST' });

export function useSetAcceptCalls() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (acceptCalls: boolean) =>
      apiFetch('/v1/me/settings', { method: 'PUT', body: json({ acceptCalls }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: settingsKey }),
  });
}

/** "12:05" style, for the time left and the call length. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
