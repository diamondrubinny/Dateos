// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type {
  Availability,
  DateFeedbackInput,
  MessageView,
  ProposeDateInput,
  Venue,
} from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';
import { chatKeys } from './realtime';

/** Places curated by the community's admins (phase 12). */
export function useVenues() {
  return useQuery({
    queryKey: ['venues'],
    queryFn: async () => (await apiFetch<{ venues: Venue[] }>('/v1/venues')).venues,
    staleTime: 5 * 60_000,
  });
}

function useDateMutation<T>(matchId: string, fn: (arg: T) => Promise<MessageView>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: chatKeys.messages(matchId) }),
        client.invalidateQueries({ queryKey: chatKeys.conversations }),
      ]),
  });
}

export const useProposeDate = (matchId: string) =>
  useDateMutation(matchId, (input: ProposeDateInput) =>
    apiFetch<MessageView>(`/v1/matches/${matchId}/dates`, { method: 'POST', body: json(input) }),
  );

export const useDateAction = (matchId: string) =>
  useDateMutation(
    matchId,
    ({ id, action }: { id: string; action: 'accept' | 'decline' | 'cancel' }) =>
      apiFetch<MessageView>(`/v1/dates/${id}/${action}`, { method: 'POST' }),
  );

/** "Did you meet?" (phase 20): private answers; only a mutual "again" is ever shown. */
export const useDateFeedback = (matchId: string) =>
  useDateMutation(matchId, ({ id, ...input }: DateFeedbackInput & { id: string }) =>
    apiFetch<MessageView>(`/v1/dates/${id}/feedback`, { method: 'POST', body: json(input) }),
  );

export const availabilityKey = (matchId: string) => ['availability', matchId] as const;

/** When we're both free (phase 20): my slots and only the overlap with the other person's. */
export function useAvailability(matchId: string, enabled = true) {
  return useQuery({
    queryKey: availabilityKey(matchId),
    queryFn: () => apiFetch<Availability>(`/v1/matches/${matchId}/availability`),
    enabled,
  });
}

export function useSetAvailability(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (slots: string[]) =>
      apiFetch<Availability>(`/v1/matches/${matchId}/availability`, {
        method: 'PUT',
        body: json({ slots }),
      }),
    onSuccess: (data) => client.setQueryData(availabilityKey(matchId), data),
  });
}
