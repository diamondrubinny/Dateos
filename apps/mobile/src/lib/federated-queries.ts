// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type {
  FederatedInteraction,
  FederatedMatch,
  FederatedMessage,
  FederatedMessagesPage,
  FederatedProfile,
  FederatedReportInput,
  FederatedStatus,
  MessageView,
  PublicProfile,
} from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';

/** Partner communities (phase 28b): joining, the deck, decisions and matches. */
export const federatedKeys = {
  status: ['federated-status'] as const,
  deck: ['federated-deck'] as const,
  matches: ['federated-matches'] as const,
};

export function useFederatedStatus() {
  return useQuery({
    queryKey: federatedKeys.status,
    queryFn: () => apiFetch<FederatedStatus>('/v1/federated/status'),
  });
}

function useAfterMembership() {
  const client = useQueryClient();
  return async (status: FederatedStatus) => {
    client.setQueryData(federatedKeys.status, status);
    await client.invalidateQueries({ queryKey: federatedKeys.deck, refetchType: 'all' });
    await client.invalidateQueries({ queryKey: federatedKeys.matches, refetchType: 'all' });
  };
}

export function useJoinFederated() {
  const after = useAfterMembership();
  return useMutation({
    mutationFn: (version: string) =>
      apiFetch<FederatedStatus>('/v1/federated/join', {
        method: 'POST',
        body: json({ version }),
      }),
    onSuccess: after,
  });
}

export function useLeaveFederated() {
  const after = useAfterMembership();
  return useMutation({
    mutationFn: () => apiFetch<FederatedStatus>('/v1/federated/leave', { method: 'POST' }),
    onSuccess: after,
  });
}

export function useFederatedDeck(enabled: boolean) {
  return useQuery({
    queryKey: federatedKeys.deck,
    enabled,
    queryFn: () => apiFetch<FederatedProfile[]>('/v1/federated/deck'),
  });
}

export function useFederatedDecide() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: FederatedInteraction) =>
      apiFetch<{ matched: boolean }>('/v1/federated/interactions', {
        method: 'POST',
        body: json(input),
      }),
    onSuccess: async (result, input) => {
      if (result.matched || input.kind === 'block') {
        await client.invalidateQueries({ queryKey: federatedKeys.matches });
      }
    },
  });
}

export function useFederatedMatches(enabled = true) {
  return useQuery({
    queryKey: federatedKeys.matches,
    enabled,
    queryFn: () => apiFetch<FederatedMatch[]>('/v1/federated/matches'),
  });
}

export function useFederatedUnmatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/v1/federated/matches/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: federatedKeys.matches }),
  });
}

/** A partner's card in the shape the profile card shows (nothing more than the card itself). */
export function asPublicProfile(p: FederatedProfile): PublicProfile {
  return {
    id: `${p.partnerId}:${p.alias}`,
    displayName: p.displayName,
    age: p.age,
    gender: p.gender,
    intention: p.intention,
    bio: p.bio,
    languages: p.languages,
    prompts: p.prompts.map((pr, i) => ({ id: `${p.alias}-${i}`, ...pr })),
    photos: p.photos,
    distance: null,
    about: null,
    voicePrompt: null,
    accessNeeds: [],
    metInPerson: false,
    atEvent: false,
    friendTakes: [],
    visiting: null,
    verified: p.verified,
    reasons: [],
  };
}

// ---------------------------------------------------------------- 28c: chat

export const federatedChatKey = (matchId: string) => ['federated-messages', matchId] as const;

/** Newest first; refreshed live (realtime) and, as a fallback, every 15 seconds. */
export function useFederatedMessages(matchId: string) {
  const client = useQueryClient();
  return useQuery({
    queryKey: federatedChatKey(matchId),
    refetchInterval: 15_000,
    queryFn: async () => {
      const page = await apiFetch<FederatedMessagesPage>(
        `/v1/federated/matches/${matchId}/messages`,
      );
      // Opening the chat marks it read: refresh the unread counts.
      void client.invalidateQueries({ queryKey: federatedKeys.matches });
      return page;
    },
  });
}

export function useSendFederatedMessage(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; clientId: string }) =>
      apiFetch<FederatedMessage>(`/v1/federated/matches/${matchId}/messages`, {
        method: 'POST',
        body: json(input),
      }),
    onSuccess: (message) => {
      client.setQueryData<FederatedMessagesPage>(federatedChatKey(matchId), (page) =>
        page && !page.messages.some((m) => m.id === message.id)
          ? { ...page, messages: [message, ...page.messages] }
          : page,
      );
      void client.invalidateQueries({ queryKey: federatedKeys.matches });
    },
  });
}

/** The shape the chat bubble shows: text only across communities (for now). */
export function asMessageView(m: FederatedMessage, matchId: string): MessageView {
  return {
    id: m.id,
    matchId,
    mine: m.mine,
    kind: 'text',
    body: m.body,
    image: null,
    voice: null,
    date: null,
    call: null,
    hidden: m.hidden,
    harm: m.harm,
    scam: m.scam,
    // Reactions stay within one community (phase 29b).
    reactions: { mine: null, theirs: null },
    unsent: false,
    replyTo: null,
    createdAt: m.createdAt,
  };
}

// ---------------------------------------------------------------- 28d: reports

export function useFederatedReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: FederatedReportInput) =>
      apiFetch<{ reportId: string }>('/v1/federated/reports', {
        method: 'POST',
        body: json(input),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: federatedKeys.matches });
      await client.invalidateQueries({ queryKey: federatedKeys.deck });
    },
  });
}
