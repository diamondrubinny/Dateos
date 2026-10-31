// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useChatSettings, useConversations } from './chat-queries';

type BadgeNavigator = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Chats with unread messages (muted and archived ones don't count). */
export const unreadChats = (matches: { unread: number; muted: boolean; archived: boolean }[]) =>
  matches.filter((m) => m.unread > 0 && !m.muted && !m.archived).length;

/**
 * Phase 72: the number on the installed web app's icon while it's open (📘 the Badging API): chats
 * with unread messages. Cleared when nothing is unread, the member turned it off, or notifications
 * are discreet (a number on a hidden app is a clue). Pushes set it while the app is closed.
 */
export function useAppBadge(enabled: boolean) {
  const settings = useChatSettings();
  const matches = useConversations();
  const on =
    enabled &&
    (settings.data?.appBadge ?? true) &&
    !(settings.data?.discreetNotifications ?? false);
  const count = on && matches.data ? unreadChats(matches.data) : 0;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return;
    const nav = navigator as BadgeNavigator;
    if (!nav.setAppBadge || !nav.clearAppBadge) return;
    void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => undefined);
  }, [count]);
}
