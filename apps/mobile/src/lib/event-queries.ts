import type { CommunityEvent } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';

export const eventKeys = {
  list: ['events'] as const,
  one: (id: string) => ['events', id] as const,
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

/** "I'm going" (true) or "I can't go after all" (false). */
export function useRsvp(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (going: boolean) =>
      apiFetch<CommunityEvent>(`/v1/events/${id}/rsvp`, { method: going ? 'POST' : 'DELETE' }),
    onSuccess: (event) => {
      client.setQueryData(eventKeys.one(id), event);
      return client.invalidateQueries({ queryKey: eventKeys.list });
    },
  });
}
