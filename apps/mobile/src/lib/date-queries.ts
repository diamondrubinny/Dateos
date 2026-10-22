import type { MessageView, ProposeDateInput, Venue } from '@dateos/shared';
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
