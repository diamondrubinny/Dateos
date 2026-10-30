// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Decision, ReportInput, VerificationState } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { apiFetch, json } from './api';
import { discoveryKeys, keys, type PickedImage } from './queries';
import { chatKeys } from './realtime';

export const safetyKeys = { verification: ['verification'] as const };

export function useReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ReportInput) =>
      apiFetch<{ reportId: string }>('/v1/reports', { method: 'POST', body: json(input) }),
    // A report usually blocks too: refresh every list the person could appear in.
    onSuccess: () => {
      for (const key of Object.values(discoveryKeys)) {
        if (Array.isArray(key)) void client.invalidateQueries({ queryKey: key });
      }
      void client.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });
}

export function useVerification() {
  return useQuery({
    queryKey: safetyKeys.verification,
    queryFn: () => apiFetch<VerificationState>('/v1/me/verification'),
    // While the selfie is being scanned, check again shortly.
    refetchInterval: (query) => (query.state.data?.processing ? 2000 : false),
  });
}

function useVerificationMutation<T>(request: (input: T) => Promise<VerificationState>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (state) => {
      client.setQueryData(safetyKeys.verification, state);
      void client.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export const useStartVerification = () =>
  useVerificationMutation(() =>
    apiFetch<VerificationState>('/v1/me/verification', { method: 'POST' }),
  );

export const useSubmitSelfie = () =>
  useVerificationMutation(async (image: PickedImage) => {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = image.file ?? (await (await fetch(image.uri)).blob());
      form.append('file', blob, image.fileName ?? 'selfie.jpg');
    } else {
      form.append('file', {
        uri: image.uri,
        name: image.fileName ?? 'selfie.jpg',
        type: image.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
    }
    return apiFetch<VerificationState>('/v1/me/verification/selfie', {
      method: 'POST',
      body: form,
    });
  });

export function useAcknowledgeNotice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/me/notices/${id}/ack`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.me }),
  });
}

/** Phase 61: decisions about my account (statement of reasons) and appeals. */
export const decisionKeys = { all: ['decisions'] as const };

export function useDecisions() {
  return useQuery({
    queryKey: decisionKeys.all,
    queryFn: () => apiFetch<{ decisions: Decision[] }>('/v1/me/decisions'),
  });
}

export function useAppeal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      apiFetch(`/v1/me/decisions/${id}/appeal`, { method: 'POST', body: json({ text }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: decisionKeys.all }),
  });
}
