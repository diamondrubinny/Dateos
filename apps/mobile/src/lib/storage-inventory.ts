// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Everything the app stores in the browser or on the device. Kept in one place so the
 * "Privacy & cookies" page, docs/legal/cookie-policy and the e2e check stay in sync.
 * All entries are strictly necessary or remember a choice the person made; there is no tracking.
 */
export interface StorageItem {
  /** A name ending in `*` stands for every key with that prefix (one per chat, phase 38). */
  name: string;
  kind: 'cookie' | 'localStorage' | 'secureStore' | 'cacheStorage';
  platform: 'web' | 'native';
  /** i18n key suffix under cookies.purpose / cookies.duration */
  purpose:
    | 'session'
    | 'sessionCache'
    | 'language'
    | 'pushToken'
    | 'callNotice'
    | 'display'
    | 'drafts'
    | 'appCode';
  duration: 'days30' | 'untilChanged' | 'untilSignOut' | 'days30Draft' | 'untilNewVersion';
}

export const storageInventory: StorageItem[] = [
  // On HTTPS the browser stores it as "__Secure-nexaheart.session_token" (HttpOnly, Secure, SameSite=Lax).
  {
    name: 'nexaheart.session_token',
    kind: 'cookie',
    platform: 'web',
    purpose: 'session',
    duration: 'days30',
  },
  {
    name: 'nexaheart.locale',
    kind: 'localStorage',
    platform: 'web',
    purpose: 'language',
    duration: 'untilChanged',
  },
  {
    name: 'nexaheart.callNotice',
    kind: 'localStorage',
    platform: 'web',
    purpose: 'callNotice',
    duration: 'untilChanged',
  },
  {
    // Phase 25: text size, easy mode, contrast and motion; never sent to the server.
    name: 'nexaheart.display',
    kind: 'localStorage',
    platform: 'web',
    purpose: 'display',
    duration: 'untilChanged',
  },
  {
    // Phase 57: the web app's own code (the same for everyone), kept by its service worker so the
    // app opens when the server or the connection is away. Nothing from the API, nothing personal.
    name: 'nexaheart-app-*',
    kind: 'cacheStorage',
    platform: 'web',
    purpose: 'appCode',
    duration: 'untilNewVersion',
  },
  {
    name: 'nexaheart_cookie',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'session',
    duration: 'days30',
  },
  {
    name: 'nexaheart_session_data',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'sessionCache',
    duration: 'untilSignOut',
  },
  {
    name: 'nexaheart.locale',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'language',
    duration: 'untilChanged',
  },
  {
    name: 'nexaheart.pushToken',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'pushToken',
    duration: 'untilSignOut',
  },
  {
    name: 'nexaheart.callNotice',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'callNotice',
    duration: 'untilChanged',
  },
  {
    name: 'nexaheart.display',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'display',
    duration: 'untilChanged',
  },
  {
    // Phase 38: message drafts, one per chat, plus their index; never sent to the server.
    name: 'nexaheart.drafts',
    kind: 'localStorage',
    platform: 'web',
    purpose: 'drafts',
    duration: 'days30Draft',
  },
  {
    name: 'nexaheart.draft.*',
    kind: 'localStorage',
    platform: 'web',
    purpose: 'drafts',
    duration: 'days30Draft',
  },
  {
    name: 'nexaheart.drafts',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'drafts',
    duration: 'days30Draft',
  },
  {
    name: 'nexaheart.draft.*',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'drafts',
    duration: 'days30Draft',
  },
];
