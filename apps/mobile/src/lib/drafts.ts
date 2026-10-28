// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { prefs } from './storage';

/**
 * Message drafts (phase 38): what was typed in a chat and not sent, kept on this device only and
 * never sent to the server. One entry per chat plus an index, so sign-out can remove them all.
 */
const INDEX_KEY = 'nexaheart.drafts';
const PREFIX = 'nexaheart.draft.';
/** Longer drafts are cut: SecureStore may refuse values much over 2 KB on some devices (📘). */
export const MAX_DRAFT_LENGTH = 1000;
export const DRAFT_DAYS = 30;
export const draftsKey = ['drafts'] as const;

type Stored = { t: string; at: number };

async function readIndex(): Promise<string[]> {
  try {
    const ids: unknown = JSON.parse((await prefs.get(INDEX_KEY)) ?? '[]');
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
const writeIndex = (ids: string[]) =>
  ids.length ? prefs.set(INDEX_KEY, JSON.stringify(ids)) : prefs.remove(INDEX_KEY);

/** Only ids that are safe as storage keys (match ids are UUIDs). */
const safeId = (id: string) => /^[\w-]{1,64}$/.test(id);

export async function loadDrafts(now = Date.now()): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const keep: string[] = [];
  for (const id of await readIndex()) {
    if (!safeId(id)) continue;
    try {
      const value = JSON.parse((await prefs.get(PREFIX + id)) ?? 'null') as Stored | null;
      if (value && typeof value.t === 'string' && now - value.at < DRAFT_DAYS * 86_400_000) {
        out[id] = value.t;
        keep.push(id);
      } else await prefs.remove(PREFIX + id);
    } catch {
      await prefs.remove(PREFIX + id);
    }
  }
  if (keep.length !== (await readIndex()).length) await writeIndex(keep);
  return out;
}

export async function saveDraft(matchId: string, text: string, now = Date.now()): Promise<void> {
  if (!safeId(matchId)) return;
  const ids = (await readIndex()).filter((id) => id !== matchId);
  if (!text.trim()) {
    await prefs.remove(PREFIX + matchId);
    await writeIndex(ids);
    return;
  }
  const value: Stored = { t: text.slice(0, MAX_DRAFT_LENGTH), at: now };
  await prefs.set(PREFIX + matchId, JSON.stringify(value));
  await writeIndex([...ids, matchId]);
}

/** On sign-out: a shared device keeps no drafts. */
export async function clearDrafts(): Promise<void> {
  for (const id of await readIndex()) if (safeId(id)) await prefs.remove(PREFIX + id);
  await prefs.remove(INDEX_KEY);
}

export function useDrafts() {
  return useQuery({ queryKey: draftsKey, queryFn: () => loadDrafts(), staleTime: Infinity });
}

/** Saves (or clears, when empty) a chat's draft and refreshes the Matches list. */
export function useSaveDraft(matchId: string) {
  const client = useQueryClient();
  return useCallback(
    async (text: string) => {
      await saveDraft(matchId, text);
      client.setQueryData<Record<string, string>>(draftsKey, (old) => {
        const next = { ...(old ?? {}) };
        if (text.trim()) next[matchId] = text.slice(0, MAX_DRAFT_LENGTH);
        else delete next[matchId];
        return next;
      });
    },
    [client, matchId],
  );
}
