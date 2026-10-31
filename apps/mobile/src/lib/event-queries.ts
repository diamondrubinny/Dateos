// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type {
  CommunityEvent,
  EventBoard,
  EventQuestion,
  MeetAgain,
  MyNoShows,
  SpeedDate,
  SpeedJoin,
  SpeedState,
} from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';

export const eventKeys = {
  list: ['events'] as const,
  one: (id: string) => ['events', id] as const,
  board: (id: string) => ['events', id, 'board'] as const,
};

/** Upcoming community events (phase 14). */
export function useEvents() {
  return useQuery({
    queryKey: eventKeys.list,
    queryFn: async () => (await apiFetch<{ events: CommunityEvent[] }>('/v1/events')).events,
    staleTime: 60_000,
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: eventKeys.one(id),
    queryFn: () => apiFetch<CommunityEvent>(`/v1/events/${id}`),
  });
}

/** "I'm going", "join the waiting list", or leave either. */
export function useRsvp(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: 'going' | 'waitlist' | 'leave') =>
      apiFetch<CommunityEvent>(`/v1/events/${id}/${action === 'waitlist' ? 'waitlist' : 'rsvp'}`, {
        method: action === 'leave' ? 'DELETE' : 'POST',
      }),
    onSuccess: (event) => {
      client.setQueryData(eventKeys.one(id), event);
      return client.invalidateQueries({ queryKey: eventKeys.list });
    },
  });
}

/** Checking in with the code on the venue's screen (phase 23). */
export function useCheckIn(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiFetch<CommunityEvent>(`/v1/events/${id}/check-in`, {
        method: 'POST',
        body: json({ code }),
      }),
    onSuccess: (event) => {
      client.setQueryData(eventKeys.one(id), event);
      return client.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

// ---------------------------------------------------------------- video speed dating (phase 23)

export const speedKey = (eventId: string) => ['speed', eventId] as const;

/** The lobby and my rounds, refreshed every few seconds while the screen is open. */
export function useSpeedState(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: speedKey(eventId),
    queryFn: () => apiFetch<SpeedState>(`/v1/events/${eventId}/speed`),
    enabled,
    refetchInterval: 4000,
  });
}

/** Enter the lobby, or stay in it (a heartbeat). */
export const enterLobby = (eventId: string) =>
  apiFetch<SpeedState>(`/v1/events/${eventId}/speed/lobby`, { method: 'POST' });
export const leaveLobby = (eventId: string) =>
  apiFetch<SpeedState>(`/v1/events/${eventId}/speed/lobby`, { method: 'DELETE' });
export const joinSpeedDate = (id: string, publicKey: string) =>
  apiFetch<SpeedJoin>(`/v1/speed-dates/${id}/join`, {
    method: 'POST',
    body: json({ publicKey }),
  });
export const leaveSpeedDate = (id: string) =>
  apiFetch<SpeedDate>(`/v1/speed-dates/${id}/leave`, { method: 'POST' });

/** "Would you like to match?" Private; only a mutual yes opens a match. */
export function useSpeedAnswer(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, yes }: { id: string; yes: boolean }) =>
      apiFetch<SpeedDate>(`/v1/speed-dates/${id}/answer`, { method: 'POST', body: json({ yes }) }),
    onSuccess: async (date) => {
      await client.invalidateQueries({ queryKey: speedKey(eventId) });
      if (date.matchId) await client.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/** Updates and my questions to the organizers (phase 27): only while going or waiting. */
export function useEventBoard(id: string, enabled: boolean) {
  return useQuery({
    queryKey: eventKeys.board(id),
    queryFn: () => apiFetch<EventBoard>(`/v1/events/${id}/board`),
    enabled,
  });
}

export function useAskOrganizers(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      apiFetch<EventQuestion>(`/v1/events/${id}/questions`, {
        method: 'POST',
        body: json({ body }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: eventKeys.board(id) }),
  });
}

export function useDeleteQuestion(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (questionId: string) =>
      apiFetch(`/v1/events/${id}/questions/${questionId}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: eventKeys.board(id) }),
  });
}

// ---------------------------------------------------------------- phase 71a

const meetAgainKey = (id: string) => ['events', id, 'meet-again'] as const;
const missesKey = ['event-misses'] as const;

/** "Meet again" after an in-person event I checked in at. */
export function useMeetAgain(id: string, enabled = true) {
  return useQuery({
    queryKey: meetAgainKey(id),
    queryFn: () => apiFetch<MeetAgain>(`/v1/events/${id}/meet-again`),
    enabled,
    retry: false,
  });
}

/** Join "Meet again", or choose someone (or take it back). */
export function useMeetAgainAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: { join: true } | { userId: string; yes: boolean }) =>
      'join' in action
        ? apiFetch<MeetAgain>(`/v1/events/${id}/meet-again`, { method: 'POST' })
        : apiFetch<MeetAgain>(`/v1/events/${id}/meet-again/${encodeURIComponent(action.userId)}`, {
            method: 'PUT',
            body: json({ yes: action.yes }),
          }),
    onSuccess: (state) => {
      client.setQueryData(meetAgainKey(id), state);
      if (state.people.some((p) => p.matchId)) {
        return client.invalidateQueries({ queryKey: ['matches'] });
      }
      return undefined;
    },
  });
}

/** My missed events, whether new places are paused, and whether I can excuse one. */
export function useEventMisses() {
  return useQuery({
    queryKey: missesKey,
    queryFn: () => apiFetch<MyNoShows>('/v1/me/event-misses'),
    staleTime: 60_000,
  });
}

export function useExcuseMiss() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) =>
      apiFetch<MyNoShows>(`/v1/me/event-misses/${eventId}/excuse`, { method: 'POST' }),
    onSuccess: (state) => client.setQueryData(missesKey, state),
  });
}
