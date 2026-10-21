import type { Conversation, MessagesPage, MessageView } from '@dateos/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { Platform } from 'react-native';
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
    mutationFn: (input: { text: string; clientId: string }) =>
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
