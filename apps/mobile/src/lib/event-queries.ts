// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
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
