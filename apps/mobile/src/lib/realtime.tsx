import type { MessagesPage, MessageView, RealtimeEvent } from '@nexaheart/shared';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { authHeaders } from './auth-client';
import { API_URL } from './config';

type Listener = (event: RealtimeEvent) => void;

interface RealtimeApi {
  send(event: { type: 'typing'; matchId: string }): void;
  subscribe(listener: Listener): () => void;
}

const RealtimeContext = createContext<RealtimeApi | null>(null);

export const chatKeys = {
  conversations: ['conversations'] as const,
  messages: (matchId: string) => ['messages', matchId] as const,
};

/** Adds or replaces a message in the cached chat (deduplicated by id). */
export function upsertMessage(data: InfiniteData<MessagesPage> | undefined, message: MessageView) {
  if (!data) return data;
  const [newest, ...older] = data.pages;
  if (!newest) return data;
  const exists = data.pages.some((p) => p.messages.some((m) => m.id === message.id));
  const pages = exists
    ? data.pages.map((p) => ({
        ...p,
        messages: p.messages.map((m) => (m.id === message.id ? message : m)),
      }))
    : [{ ...newest, messages: [...newest.messages, message] }, ...older];
  return { ...data, pages };
}

/**
 * One WebSocket per signed-in app session, with exponential-backoff reconnects. Events update
 * the query cache directly, so every screen stays live without polling.
 */
export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const client = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let closedByUs = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const handle = (event: RealtimeEvent) => {
      if (event.type === 'message.new') {
        client.setQueryData<InfiniteData<MessagesPage>>(chatKeys.messages(event.matchId), (d) =>
          upsertMessage(d, event.message),
        );
        void client.invalidateQueries({ queryKey: chatKeys.conversations });
      } else if (event.type === 'message.updated') {
        void client.invalidateQueries({ queryKey: chatKeys.messages(event.matchId) });
        void client.invalidateQueries({ queryKey: chatKeys.conversations });
      } else if (event.type === 'message.read') {
        client.setQueryData<InfiniteData<MessagesPage>>(chatKeys.messages(event.matchId), (d) =>
          d
            ? {
                ...d,
                pages: d.pages.map((p, i) => (i === 0 ? { ...p, otherReadAt: event.at } : p)),
              }
            : d,
        );
      } else if (event.type === 'match.new' || event.type === 'match.closed') {
        void client.invalidateQueries({ queryKey: chatKeys.conversations });
        void client.invalidateQueries({ queryKey: ['matches'] });
      }
      listeners.current.forEach((l) => l(event));
    };

    const connect = async () => {
      const url = `${API_URL.replace(/^http/, 'ws')}/v1/ws`;
      // Browsers send the session cookie themselves; React Native accepts headers as a 3rd argument.
      const socket =
        Platform.OS === 'web'
          ? new WebSocket(url)
          : new (
              WebSocket as unknown as new (
                u: string,
                p: undefined,
                o: { headers: Record<string, string> },
              ) => WebSocket
            )(url, undefined, { headers: await authHeaders() });
      socketRef.current = socket;
      socket.onopen = () => (attempt = 0);
      socket.onmessage = (message) => {
        try {
          handle(JSON.parse(String(message.data)) as RealtimeEvent);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        socketRef.current = null;
        if (closedByUs) return;
        attempt += 1;
        timer = setTimeout(() => void connect(), Math.min(30_000, 1_000 * 2 ** attempt));
        // Catch up on anything missed while disconnected.
        void client.invalidateQueries({ queryKey: ['messages'] });
        void client.invalidateQueries({ queryKey: chatKeys.conversations });
      };
    };
    void connect();
    return () => {
      closedByUs = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, [enabled, client]);

  const api: RealtimeApi = {
    send: (event) => {
      if (socketRef.current?.readyState === 1) socketRef.current.send(JSON.stringify(event));
    },
    subscribe: (listener) => {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
  };
  return <RealtimeContext.Provider value={api}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeApi {
  const api = useContext(RealtimeContext);
  if (!api) throw new Error('useRealtime must be used inside RealtimeProvider');
  return api;
}
