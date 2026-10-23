// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { captchaHeaders } from './captcha';
import type {
  DoubleChat,
  DoubleMessage,
  FriendMode,
  FriendTake,
  MyPair,
  PairCard,
  PublicProfile,
  WriteTakeInput,
} from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform, Share } from 'react-native';
import { apiFetch, json } from './api';
import { newClientId } from './chat-queries';
import { webUrl } from './config';

/** Friends (phase 22): friends mode, friends' takes, pairs and double dates. */
export const friendKeys = {
  mode: ['friend-mode'] as const,
  deck: ['friends-discover'] as const,
  takes: ['my-takes'] as const,
  pair: ['my-pair'] as const,
  pairs: ['pairs-discover'] as const,
  doubles: ['doubles'] as const,
  messages: (id: string) => ['double-messages', id] as const,
};

// ---------------------------------------------------------------- friends mode

export function useFriendMode() {
  return useQuery({
    queryKey: friendKeys.mode,
    queryFn: () => apiFetch<FriendMode>('/v1/me/friend-mode'),
  });
}

export function useSetFriendMode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: FriendMode) =>
      apiFetch<FriendMode>('/v1/me/friend-mode', { method: 'PUT', body: json(input) }),
    onSuccess: async (data) => {
      client.setQueryData(friendKeys.mode, data);
      await client.invalidateQueries({ queryKey: friendKeys.deck, refetchType: 'all' });
    },
  });
}

export function useFriendsDiscover(enabled: boolean) {
  return useQuery({
    queryKey: friendKeys.deck,
    enabled,
    queryFn: async () =>
      (await apiFetch<{ profiles: PublicProfile[] }>('/v1/friends/discover?limit=20')).profiles,
  });
}

// ---------------------------------------------------------------- sharing a link

/**
 * Shares a link with the system share sheet where there is one, otherwise copies it. Returns what
 * happened, so the screen can say "Copied" or show the link to copy by hand.
 */
export async function shareLink(
  url: string,
  message: string,
): Promise<'shared' | 'copied' | 'shown'> {
  try {
    if (Platform.OS !== 'web') {
      await Share.share({ message: `${message} ${url}` });
      return 'shared';
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ text: message, url });
      return 'shared';
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch {
    // Cancelled or not allowed: the link is shown instead.
  }
  return 'shown';
}

export const takeUrl = (token: string) => `${webUrl()}/take/${token}`;
export const pairUrl = (token: string) => `${webUrl()}/pair/join/${token}`;

// ---------------------------------------------------------------- friends' takes

export function useMyTakes() {
  return useQuery({
    queryKey: friendKeys.takes,
    queryFn: async () => (await apiFetch<{ takes: FriendTake[] }>('/v1/me/takes')).takes,
  });
}

export const createTakeLink = () =>
  apiFetch<{ token: string; expiresAt: string }>('/v1/me/takes/link', { method: 'POST' });

function useTakeMutation(fn: (id: string) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: friendKeys.takes }),
  });
}
export const useApproveTake = () =>
  useTakeMutation((id) => apiFetch(`/v1/me/takes/${id}/approve`, { method: 'POST' }));
export const useRemoveTake = () =>
  useTakeMutation((id) => apiFetch(`/v1/me/takes/${id}`, { method: 'DELETE' }));

/** Public (no account): the friend's side of a take link. */
export const takeLinkInfo = (token: string) =>
  apiFetch<{ name: string }>(`/v1/takes/${encodeURIComponent(token)}`);
export const writeTake = (token: string, input: WriteTakeInput, captchaToken?: string | null) =>
  apiFetch(`/v1/takes/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: json(input),
    headers: captchaHeaders(captchaToken),
  });

// ---------------------------------------------------------------- pairs and double dates

export function useMyPair() {
  return useQuery({
    queryKey: friendKeys.pair,
    queryFn: async () => (await apiFetch<{ pair: MyPair | null }>('/v1/me/pair')).pair,
  });
}

export const createPairInvite = () =>
  apiFetch<{ token: string; expiresAt: string }>('/v1/pairs/invite', { method: 'POST' });

export function useJoinPair() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<MyPair>(`/v1/pairs/join/${encodeURIComponent(token)}`, { method: 'POST' }),
    onSuccess: (pair) => client.setQueryData(friendKeys.pair, pair),
  });
}

export function useLeavePair() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/v1/me/pair', { method: 'DELETE' }),
    onSuccess: async () => {
      client.setQueryData(friendKeys.pair, null);
      await client.invalidateQueries({ queryKey: friendKeys.doubles });
    },
  });
}

export function usePairsDiscover(enabled: boolean) {
  return useQuery({
    queryKey: friendKeys.pairs,
    enabled,
    queryFn: async () => (await apiFetch<{ pairs: PairCard[] }>('/v1/pairs/discover')).pairs,
  });
}

export function usePairDecision() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'like' | 'pass' }) =>
      apiFetch<{ doubleId: string | null }>(`/v1/pairs/${id}/${kind}`, { method: 'POST' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: friendKeys.pairs });
      await client.invalidateQueries({ queryKey: friendKeys.doubles });
    },
  });
}

export function useDoubles() {
  return useQuery({
    queryKey: friendKeys.doubles,
    queryFn: async () => (await apiFetch<{ doubles: DoubleChat[] }>('/v1/doubles')).doubles,
  });
}

export function useDoubleMessages(id: string) {
  return useQuery({
    queryKey: friendKeys.messages(id),
    queryFn: async () =>
      (await apiFetch<{ messages: DoubleMessage[] }>(`/v1/doubles/${id}/messages`)).messages,
  });
}

export function useSendDouble(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<DoubleMessage>(`/v1/doubles/${id}/messages`, {
        method: 'POST',
        body: json({ text, clientId: newClientId() }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: friendKeys.messages(id) });
      await client.invalidateQueries({ queryKey: friendKeys.doubles });
    },
  });
}

export function useLeaveDouble(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`/v1/doubles/${id}/leave`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: friendKeys.doubles }),
  });
}
