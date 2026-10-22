import type { Locale } from '@nexaheart/shared';
import type {
  CoachResponse,
  ConsentInput,
  InstanceInfo,
  InteractionInput,
  LikeReceived,
  LocationInput,
  MatchSummary,
  PublicProfile,
  MeResponse,
  Photo,
  Preferences,
  ProfileInput,
  ProfileUpdate,
  PromptAnswer,
} from '@nexaheart/shared';
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
    // Refetch even when no screen is currently observing /v1/me, so the next screen's redirect
    // logic never acts on stale onboarding state.
    onSuccess: () => client.invalidateQueries({ queryKey: keys.me, refetchType: 'all' }),
  });
}

export const useCreateProfile = () =>
  useMeMutation((input: ProfileInput) =>
    apiFetch('/v1/me/profile', { method: 'POST', body: json(input) }),
  );
export const useUpdateProfile = () =>
  useMeMutation(async (input: ProfileUpdate) => {
    await apiFetch('/v1/me/profile', { method: 'PATCH', body: json(input) });
  });
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

// ---------------------------------------------------------------- discovery

export const discoveryKeys = {
  discover: ['discover'] as const,
  picks: ['picks'] as const,
  likes: ['likes'] as const,
  matches: ['matches'] as const,
  profile: (id: string) => ['profile', id] as const,
};

export function useDiscover() {
  return useQuery({
    queryKey: discoveryKeys.discover,
    queryFn: async () =>
      (await apiFetch<{ profiles: PublicProfile[] }>('/v1/discover?limit=10')).profiles,
  });
}

export function usePicks() {
  return useQuery({
    queryKey: discoveryKeys.picks,
    queryFn: async () =>
      (await apiFetch<{ profiles: PublicProfile[] }>('/v1/picks/today')).profiles,
  });
}

export function useLikes() {
  return useQuery({
    queryKey: discoveryKeys.likes,
    queryFn: async () => (await apiFetch<{ likes: LikeReceived[] }>('/v1/likes')).likes,
  });
}

export function useMatches() {
  return useQuery({
    queryKey: discoveryKeys.matches,
    queryFn: async () => (await apiFetch<{ matches: MatchSummary[] }>('/v1/matches')).matches,
  });
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: discoveryKeys.profile(id),
    queryFn: () => apiFetch<PublicProfile>(`/v1/profiles/${id}`),
  });
}

function useDiscoveryMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () =>
      Promise.all(
        [discoveryKeys.picks, discoveryKeys.likes, discoveryKeys.matches].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

export const useInteract = () =>
  useDiscoveryMutation((input: InteractionInput) =>
    apiFetch<{ matched: boolean; matchId: string | null }>('/v1/interactions', {
      method: 'POST',
      body: json(input),
    }),
  );
export const useBlock = () =>
  useDiscoveryMutation((userId: string) =>
    apiFetch('/v1/blocks', { method: 'POST', body: json({ userId }) }),
  );
export const useUnmatch = () =>
  useDiscoveryMutation((matchId: string) =>
    apiFetch(`/v1/matches/${matchId}`, { method: 'DELETE' }),
  );

export const useSetLocation = () =>
  useMeMutation((input: LocationInput) =>
    apiFetch('/v1/me/location', { method: 'PUT', body: json(input) }),
  );
export const useClearLocation = () =>
  useMeMutation(() => apiFetch('/v1/me/location', { method: 'DELETE' }));

// ---------------------------------------------------------------- profile coach

export const coachKey = ['coach'] as const;

export function useCoach() {
  return useQuery({ queryKey: coachKey, queryFn: () => apiFetch<CoachResponse>('/v1/me/coach') });
}

export function useBioIdeas() {
  return useMutation({
    mutationFn: (locale: Locale) =>
      apiFetch<{ ideas: string[] }>('/v1/me/coach/bio-ideas', {
        method: 'POST',
        body: json({ locale }),
      }),
  });
}
