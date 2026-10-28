// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { captchaHeaders } from './captcha';
import {
  normalizeEmail,
  type ContactHides,
  type Invite,
  type JoinWaitlistInput,
  type RedeemInviteInput,
  type SignedInDevice,
  type AccountActivity,
} from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { apiFetch, json } from './api';
import { authClient } from './auth-client';
import { discoveryKeys } from './queries';

/** SHA-256 of a normalized address, computed here: addresses themselves never leave the device. */
export async function hashEmail(email: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, normalizeEmail(email), {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

/** Finds email addresses in pasted text (one per line, commas, a vCard ...), without duplicates. */
export function extractEmails(text: string): string[] {
  const found = text.match(/[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[a-z]{2,}/gi) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))];
}

const contactKey = ['contact-hides'] as const;

export function useContactHides() {
  return useQuery({
    queryKey: contactKey,
    queryFn: () => apiFetch<ContactHides>('/v1/me/contact-hides'),
  });
}

function useContactMutation<T>(fn: (input: T) => Promise<ContactHides>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data) => {
      client.setQueryData(contactKey, data);
      // Who Discover shows changes.
      for (const queryKey of [discoveryKeys.discover, discoveryKeys.picks, discoveryKeys.likes]) {
        await client.invalidateQueries({ queryKey, refetchType: 'all' });
      }
    },
  });
}

/** Hashes on the device, then sends at most 2,000 hashes per request. */
export const useHideContacts = () =>
  useContactMutation(async (emails: string[]) => {
    const hashes = await Promise.all(emails.slice(0, 2000).map(hashEmail));
    return apiFetch<ContactHides>('/v1/me/contact-hides', {
      method: 'POST',
      body: json({ hashes }),
    });
  });

export const useClearContactHides = () =>
  useContactMutation(() => apiFetch<ContactHides>('/v1/me/contact-hides', { method: 'DELETE' }));

// ---------------------------------------------------------------- sign-up

export const redeemInvite = (input: RedeemInviteInput) =>
  apiFetch<null>('/v1/signup/redeem', { method: 'POST', body: json(input) });

export const joinWaitlist = (input: JoinWaitlistInput, captchaToken?: string | null) =>
  apiFetch<{ ok: true }>('/v1/signup/waitlist', {
    method: 'POST',
    body: json(input),
    headers: captchaHeaders(captchaToken),
  });

const invitesKey = ['my-invites'] as const;
export function useMyInvites() {
  return useQuery({
    queryKey: invitesKey,
    queryFn: () => apiFetch<{ allowed: boolean; invites: Invite[] }>('/v1/me/invites'),
  });
}
export function useCreateInvite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Invite>('/v1/me/invites', { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: invitesKey }),
  });
}

// ---------------------------------------------------------------- passkeys (web)

export interface PasskeyInfo {
  id: string;
  name: string | null;
  createdAt: string | null;
}

/** Whether this browser can use passkeys at all. */
export const passkeysSupported = () =>
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential === 'function';

const passkeysKey = ['passkeys'] as const;
export function usePasskeys(enabled: boolean) {
  return useQuery({
    queryKey: passkeysKey,
    enabled,
    queryFn: () => apiFetch<PasskeyInfo[]>('/v1/auth/passkey/list-user-passkeys'),
  });
}

type PasskeyClient = {
  passkey: {
    addPasskey: (opts: { name?: string }) => Promise<{ error: { message?: string } | null }>;
  };
  signIn: { passkey: () => Promise<{ error: { message?: string } | null }> };
};
const passkeyClient = () => authClient as unknown as PasskeyClient;

export function useAddPasskey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await passkeyClient().passkey.addPasskey({ name });
      if (res.error) throw new Error(res.error.message ?? 'passkey');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: passkeysKey }),
  });
}

export function useRemovePasskey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch('/v1/auth/passkey/delete-passkey', { method: 'POST', body: json({ id }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: passkeysKey }),
  });
}

export async function signInWithPasskey(): Promise<boolean> {
  const res = await passkeyClient().signIn.passkey();
  return !res.error;
}

// ---------------------------------------------------------------- your devices (phase 29)

const devicesKey = ['signed-in-devices'] as const;

export function useSignedInDevices() {
  return useQuery({
    queryKey: devicesKey,
    queryFn: async () => (await apiFetch<{ devices: SignedInDevice[] }>('/v1/me/sessions')).devices,
  });
}

/** Account activity (phase 31). */
export function useAccountActivity() {
  return useQuery({
    queryKey: ['account-activity'],
    queryFn: async () => (await apiFetch<AccountActivity>('/v1/me/activity')).events,
  });
}

export function useSignOutDevice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/v1/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: devicesKey });
      await client.invalidateQueries({ queryKey: ['account-activity'] });
    },
  });
}

export function useSignOutOthers() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; signedOut: number }>('/v1/me/sessions/sign-out-others', {
        method: 'POST',
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: devicesKey });
      await client.invalidateQueries({ queryKey: ['account-activity'] });
    },
  });
}
