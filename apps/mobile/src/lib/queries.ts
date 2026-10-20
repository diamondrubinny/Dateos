import type {
  ConsentInput,
  InstanceInfo,
  MeResponse,
  Photo,
  Preferences,
  ProfileInput,
  ProfileUpdate,
  PromptAnswer,
} from '@dateos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { apiFetch, json } from './api';

export const keys = { me: ['me'] as const, instance: ['instance'] as const };

export function useInstance() {
  return useQuery({
    queryKey: keys.instance,
    queryFn: () => apiFetch<InstanceInfo>('/v1/instance'),
    staleTime: 60 * 60 * 1000,
  });
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => apiFetch<MeResponse>('/v1/me'),
    enabled,
    // While photos are being scanned, refresh until they settle.
    refetchInterval: (query) =>
      query.state.data?.photos.some((p) => p.status === 'quarantine' || p.status === 'processing')
        ? 1500
        : false,
  });
}

function useMeMutation<TInput>(request: (input: TInput) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.me }),
  });
}

export const useCreateProfile = () =>
  useMeMutation((input: ProfileInput) =>
    apiFetch('/v1/me/profile', { method: 'POST', body: json(input) }),
  );
export const useUpdateProfile = () =>
  useMeMutation((input: ProfileUpdate) =>
    apiFetch('/v1/me/profile', { method: 'PATCH', body: json(input) }),
  );
export const useSetPreferences = () =>
  useMeMutation((input: Preferences) =>
    apiFetch('/v1/me/preferences', { method: 'PUT', body: json(input) }),
  );
export const useSetPrompts = () =>
  useMeMutation((prompts: PromptAnswer[]) =>
    apiFetch('/v1/me/prompts', { method: 'PUT', body: json({ prompts }) }),
  );
export const useSetConsents = () =>
  useMeMutation((consents: ConsentInput[]) =>
    apiFetch('/v1/me/consents', { method: 'PUT', body: json({ consents }) }),
  );
export const useDeletePhoto = () =>
  useMeMutation((id: string) => apiFetch(`/v1/me/photos/${id}`, { method: 'DELETE' }));
export const useDeleteAccount = () =>
  useMutation({ mutationFn: () => apiFetch('/v1/me', { method: 'DELETE' }) });

export interface PickedImage {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  file?: File | null;
}

export const useUploadPhoto = () =>
  useMeMutation(async (image: PickedImage) => {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = image.file ?? (await (await fetch(image.uri)).blob());
      form.append('file', blob, image.fileName ?? 'photo.jpg');
    } else {
      // React Native's FormData accepts { uri, name, type } file descriptors.
      form.append('file', {
        uri: image.uri,
        name: image.fileName ?? 'photo.jpg',
        type: image.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
    }
    return apiFetch<Photo>('/v1/me/photos', { method: 'POST', body: form });
  });
