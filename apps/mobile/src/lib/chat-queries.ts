// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type {
  AlbumShareMode,
  SharedAlbum,
  Conversation,
  MatchPrefs,
  QuietHours,
  MessagesPage,
  MessageView,
  ReactionEmoji,
  ChatSearchResult,
  Transcript,
} from '@nexaheart/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { Platform } from 'react-native';
import i18n, { isAppLocale } from '../i18n';
import { apiFetch, json } from './api';
import type { PickedImage } from './queries';
import { chatKeys, upsertMessage } from './realtime';

export function useConversations() {
  return useQuery({
    queryKey: chatKeys.conversations,
    queryFn: async () =>
      (await apiFetch<{ conversations: Conversation[] }>('/v1/conversations')).conversations,
  });
}

export function useMessages(matchId: string) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(matchId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiFetch<MessagesPage>(
        `/v1/matches/${matchId}/messages${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.before ?? undefined,
  });
}

/** Unique per send; retries reuse it so the server stores the message once. */
export function newClientId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useSendMessage(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; clientId: string; replyToId?: string }) =>
      apiFetch<MessageView>(`/v1/matches/${matchId}/messages`, {
        method: 'POST',
        body: json(input),
      }),
    onSuccess: (message) => {
      client.setQueryData<InfiniteData<MessagesPage>>(chatKeys.messages(matchId), (d) =>
        upsertMessage(d, message),
      );
      void client.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });
}

/** Mute, archive or pin a chat, privately (phases 31, 38). */
export function useChatPrefs(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { muted?: boolean; archived?: boolean; pinned?: boolean }) =>
      apiFetch<MatchPrefs>(`/v1/matches/${encodeURIComponent(matchId)}/prefs`, {
        method: 'PUT',
        body: json(input),
      }),
    onSuccess: (prefs) => {
      client.setQueryData<Conversation[]>(chatKeys.conversations, (list) =>
        list?.map((c) => (c.matchId === matchId ? { ...c, ...prefs } : c)),
      );
      // Pinning changes the order, which the server decides.
      void client.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });
}

/** Unsend my own message (phase 30): both people see "Message unsent". */
export function useUnsend(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<MessageView>(`/v1/matches/${matchId}/messages/${encodeURIComponent(messageId)}`, {
        method: 'DELETE',
      }),
    onSuccess: (message) => {
      client.setQueryData<InfiniteData<MessagesPage>>(chatKeys.messages(matchId), (d) =>
        upsertMessage(d, message),
      );
      void client.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });
}

/** React to a message, or remove my reaction with null (phase 29b). */
export function useReact(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: ReactionEmoji | null }) =>
      apiFetch<MessageView>(
        `/v1/matches/${matchId}/messages/${encodeURIComponent(messageId)}/reaction`,
        { method: 'PUT', body: json({ emoji }) },
      ),
    onSuccess: (message) => {
      client.setQueryData<InfiniteData<MessagesPage>>(chatKeys.messages(matchId), (d) =>
        upsertMessage(d, message),
      );
    },
  });
}

export function useSendImage(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (image: PickedImage) => {
      const form = new FormData();
      if (Platform.OS === 'web')
        form.append(
          'file',
          image.file ?? (await (await fetch(image.uri)).blob()),
          image.fileName ?? 'photo.jpg',
        );
      else
        form.append('file', {
          uri: image.uri,
          name: image.fileName ?? 'photo.jpg',
          type: image.mimeType ?? 'image/jpeg',
        } as unknown as Blob);
      return apiFetch<MessageView>(`/v1/matches/${matchId}/images`, { method: 'POST', body: form });
    },
    onSuccess: (message) =>
      client.setQueryData<InfiniteData<MessagesPage>>(chatKeys.messages(matchId), (d) =>
        upsertMessage(d, message),
      ),
  });
}

export const checkMessage = (text: string) =>
  apiFetch<{ flagged: boolean; categories: string[] }>('/v1/messages/check', {
    method: 'POST',
    body: json({ text }),
  });

export const markRead = (matchId: string) =>
  apiFetch(`/v1/matches/${matchId}/read`, { method: 'POST' });

export function useIcebreakers(matchId: string, locale: string, enabled: boolean) {
  return useQuery({
    queryKey: ['icebreakers', matchId, locale],
    enabled,
    staleTime: Infinity,
    queryFn: async () =>
      (
        await apiFetch<{ suggestions: string[] }>(
          `/v1/matches/${matchId}/icebreakers?locale=${locale}`,
        )
      ).suggestions,
  });
}

export function useSendVoice(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (recording: { uri: string }) => {
      const form = new FormData();
      if (Platform.OS === 'web') {
        // The browser recorder gives a blob: URL (WebM/Ogg/MP4 depending on the browser).
        const blob = await (await fetch(recording.uri)).blob();
        form.append('file', blob, 'voice');
      } else {
        form.append('file', {
          uri: recording.uri,
          name: 'voice.m4a',
          type: 'audio/mp4',
        } as unknown as Blob);
      }
      // The app's language tells the speech model what it will hear (transcripts, phase 26).
      return apiFetch<MessageView>(`/v1/matches/${matchId}/voice${recordingLang()}`, {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: (message) =>
      client.setQueryData<InfiniteData<MessagesPage>>(chatKeys.messages(matchId), (d) =>
        upsertMessage(d, message),
      ),
  });
}

export const settingsKey = ['chat-settings'] as const;

export function useChatSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () =>
      apiFetch<{
        acceptVoice: boolean;
        acceptCalls: boolean;
        allowTranscripts: boolean;
        readReceipts: boolean;
        signinAlerts: boolean;
        notifyMatches: boolean;
        notifyMessages: boolean;
        notifyEvents: boolean;
        quietHours: QuietHours | null;
        dailyLikeLimit: number | null;
        verifiedContactOnly: boolean;
        blurPhotos: boolean;
        hideDistance: boolean;
        discreetNotifications: boolean;
        pushDevices: number;
      }>('/v1/me/settings'),
  });
}

export function useSetAcceptVoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (acceptVoice: boolean) =>
      apiFetch('/v1/me/settings', { method: 'PUT', body: json({ acceptVoice }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: settingsKey }),
  });
}

/** Phase 26: may people I send voice to read it as text? Off also deletes texts already made. */
export function useSetAllowTranscripts() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (allowTranscripts: boolean) =>
      apiFetch('/v1/me/settings', { method: 'PUT', body: json({ allowTranscripts }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: settingsKey }),
  });
}

/** One of my settings at a time (phase 33: which notifications). */
export function useSetSetting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, boolean>) =>
      apiFetch('/v1/me/settings', { method: 'PUT', body: json(input) }),
    onSuccess: () => client.invalidateQueries({ queryKey: settingsKey }),
  });
}

/** Phase 65, who can reach me: new likes a day (null: no limit) and verified members only. */
export function useSetReach() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      dailyLikeLimit?: number | null;
      verifiedContactOnly?: boolean;
      blurPhotos?: boolean;
      hideDistance?: boolean;
      discreetNotifications?: boolean;
    }) => apiFetch('/v1/me/settings', { method: 'PUT', body: json(input) }),
    onSuccess: () => client.invalidateQueries({ queryKey: settingsKey }),
  });
}

/** Phase 66a: show my blurred photos to this match, or take it back. */
export function useShowPhotos(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (shown: boolean) =>
      apiFetch(`/v1/matches/${matchId}/photos-shown`, { method: 'PUT', body: json({ shown }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: chatKeys.messages(matchId) }),
  });
}

/** Phase 66c: share my private album in this chat (once, 10 minutes, no limit), or stop. */
export function useAlbumShare(matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mode: AlbumShareMode | null) =>
      mode
        ? apiFetch(`/v1/matches/${matchId}/album-share`, { method: 'PUT', body: json({ mode }) })
        : apiFetch(`/v1/matches/${matchId}/album-share`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: chatKeys.messages(matchId) }),
  });
}

/** Phase 66c: the other person's album; fetching it starts the window, so only on purpose. */
export function useSharedAlbum(matchId: string) {
  return useQuery({
    queryKey: ['shared-album', matchId],
    queryFn: () => apiFetch<SharedAlbum>(`/v1/matches/${matchId}/album`),
    gcTime: 0,
    staleTime: Infinity,
  });
}

/** Quiet hours (phase 39); null turns them off. */
export function useSetQuietHours() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (quietHours: QuietHours | null) =>
      apiFetch('/v1/me/settings', { method: 'PUT', body: json({ quietHours }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: settingsKey }),
  });
}

/** Email me about sign-ins from a new kind of device (phase 32). */
export function useSetSigninAlerts() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (signinAlerts: boolean) =>
      apiFetch('/v1/me/settings', { method: 'PUT', body: json({ signinAlerts }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: settingsKey }),
  });
}

/** Search a chat (phase 32): only when there's something to search for. */
export function useChatSearch(matchId: string, q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ['chat-search', matchId, term],
    enabled: term.length >= 2,
    queryFn: () =>
      apiFetch<ChatSearchResult>(
        `/v1/matches/${encodeURIComponent(matchId)}/messages/search?q=${encodeURIComponent(term)}`,
      ),
  });
}

/** Read receipts, both ways (phase 30). */
export function useSetReadReceipts() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (readReceipts: boolean) =>
      apiFetch('/v1/me/settings', { method: 'PUT', body: json({ readReceipts }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: settingsKey }),
  });
}

/** `?lang=..` for a recording in the app's current language (phase 26). */
export function recordingLang(prefix: '?' | '&' = '?'): string {
  return isAppLocale(i18n.language) ? `${prefix}lang=${i18n.language}` : '';
}

/** Voice transcripts (phase 26): made on the community's server when someone asks. */
export const transcriptKey = (path: string) => ['transcript', path] as const;
export function useTranscript(path: string, enabled: boolean) {
  return useQuery({
    queryKey: transcriptKey(path),
    queryFn: () => apiFetch<Transcript>(`${path}/transcript`),
    enabled,
    // While the worker is on it, check every few seconds.
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3000 : false),
  });
}
export function useRequestTranscript(path: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Transcript>(`${path}/transcript`, { method: 'POST' }),
    onSuccess: (data) => client.setQueryData(transcriptKey(path), data),
  });
}
