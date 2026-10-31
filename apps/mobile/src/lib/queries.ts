// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { intentions, type Intention, type Locale } from '@nexaheart/shared';
import type {
  MyAlbum,
  CoachResponse,
  ConsentInput,
  InstanceInfo,
  InteractionInput,
  LikeReceived,
  LocationInput,
  MatchSummary,
  PublicProfile,
  ProfilePreview,
  MeResponse,
  Photo,
  Preferences,
  ProfileInput,
  ProfileUpdate,
  PromptAnswer,
  PauseDuration,
  About,
  AccessNeeds,
  IdentityInput,
  FaithAnswers,
  Dealbreakers,
  Place,
  TravelInput,
  TravelState,
  YourTurn,
  UndoPassResult,
  BlockedPerson,
  MyVisibility,
} from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { apiFetch, json } from './api';
import { recordingLang } from './chat-queries';

export const keys = { me: ['me'] as const, instance: ['instance'] as const };

export function useInstance() {
  return useQuery({
    queryKey: keys.instance,
    queryFn: () => apiFetch<InstanceInfo>('/v1/instance'),
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Phase 62b: the intentions this community offers (all of them until the server says otherwise),
 * plus any in `keep` that a member already chose, so a narrowed list never loses their choice.
 */
export function useOfferedIntentions(keep: readonly Intention[] = []): Intention[] {
  const offered = useInstance().data?.community?.intentions ?? intentions;
  return intentions.filter((i) => offered.includes(i) || keep.includes(i));
}

/** Phase 66b: the Match Note; null deletes it. */
export function useSetMatchNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (note: string | null) =>
      apiFetch('/v1/me/match-note', { method: 'PUT', body: json({ note }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => apiFetch<MeResponse>('/v1/me'),
    enabled,
    // While photos are being scanned, refresh until they settle.
    refetchInterval: (query) =>
      query.state.data?.photos.some(
        (p) => p.status === 'quarantine' || p.status === 'processing',
      ) || ['quarantine', 'processing'].includes(query.state.data?.voicePrompt?.status ?? '')
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

/** Change the account's email (phase 41): a link goes to the new address. */
export const useRequestEmailChange = () =>
  useMutation({
    mutationFn: (email: string) =>
      apiFetch('/v1/me/email', { method: 'POST', body: json({ email }) }),
  });
export function useConfirmEmailChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<{ email: string }>('/v1/me/email/confirm', {
        method: 'POST',
        body: json({ token }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.me, refetchType: 'all' }),
  });
}

/** Describe a photo for screen readers (phase 40); empty clears it. */
export const useDescribePhoto = () =>
  useMeMutation(({ photoId, description }: { photoId: string; description: string }) =>
    apiFetch(`/v1/me/photos/${encodeURIComponent(photoId)}/description`, {
      method: 'PUT',
      body: json({ description }),
    }),
  );

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
/** Take a break and incognito (phase 18): the feeds change too, so they refresh with /v1/me. */
function useBreakMutation<TInput>(request: (input: TInput) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async () => {
      for (const queryKey of [
        keys.me,
        discoveryKeys.discover,
        discoveryKeys.picks,
        discoveryKeys.likes,
      ]) {
        await client.invalidateQueries({ queryKey, refetchType: 'all' });
      }
    },
  });
}
export const usePause = () =>
  useBreakMutation((duration: PauseDuration) =>
    apiFetch('/v1/me/pause', { method: 'PUT', body: json({ duration }) }),
  );
export const useSetIncognito = () =>
  useBreakMutation((on: boolean) =>
    apiFetch('/v1/me/incognito', { method: 'PUT', body: json({ on }) }),
  );
/** "Met someone here in person" badge (phase 20): off by default. */
export const useSetMetBadge = () =>
  useBreakMutation((on: boolean) =>
    apiFetch('/v1/me/met-badge', { method: 'PUT', body: json({ on }) }),
  );
/** "Checked in at an event" badge (phase 23): off by default. */
export const useSetEventBadge = () =>
  useBreakMutation((on: boolean) =>
    apiFetch('/v1/me/event-badge', { method: 'PUT', body: json({ on }) }),
  );
export const useResume = () =>
  useBreakMutation(() => apiFetch('/v1/me/pause', { method: 'DELETE' }));
/** About me and dealbreakers (phase 19): what Discover shows changes, so the feeds refresh. */
export const useSetAbout = () =>
  useBreakMutation((about: About) =>
    apiFetch('/v1/me/about', { method: 'PUT', body: json(about) }),
  );
/** Accessibility needs (phase 25): shown needs change what others see, so the feeds refresh. */
export const useSetAccessNeeds = () =>
  useBreakMutation((input: AccessNeeds) =>
    apiFetch('/v1/me/access-needs', { method: 'PUT', body: json(input) }),
  );
/** Gender identity and pronouns (phase 62a): what others see changes, so the feeds refresh. */
export const useSetIdentity = () =>
  useBreakMutation((input: IdentityInput) =>
    apiFetch('/v1/me/identity', { method: 'PUT', body: json(input) }),
  );
/** Faith, stream and observance (phase 62b): what others see changes, so the feeds refresh. */
export const useSetFaith = () =>
  useBreakMutation((input: FaithAnswers) =>
    apiFetch('/v1/me/faith', { method: 'PUT', body: json(input) }),
  );
export const useSetDealbreakers = () =>
  useBreakMutation((d: Dealbreakers) =>
    apiFetch('/v1/me/dealbreakers', { method: 'PUT', body: json(d) }),
  );
/** Voice prompt (phase 19): the same upload as a voice message, to the profile. */
export const useSetVoicePrompt = () =>
  useMeMutation(async ({ uri, promptKey }: { uri: string; promptKey: string }) => {
    const form = new FormData();
    if (Platform.OS === 'web') {
      form.append('file', await (await fetch(uri)).blob(), 'voice');
    } else {
      form.append('file', { uri, name: 'voice.m4a', type: 'audio/mp4' } as unknown as Blob);
    }
    return apiFetch(
      `/v1/me/voice-prompt?promptKey=${encodeURIComponent(promptKey)}${recordingLang('&')}`,
      {
        method: 'POST',
        body: form,
      },
    );
  });
export const useRemoveVoicePrompt = () =>
  useMeMutation(() => apiFetch('/v1/me/voice-prompt', { method: 'DELETE' }));
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

// ---------------------------------------------------------------- private album (phase 66c)

export const albumKey = ['my-album'] as const;

export function useMyAlbum() {
  return useQuery({
    queryKey: albumKey,
    queryFn: () => apiFetch<MyAlbum>('/v1/me/album'),
    // While a new photo is being scanned, refresh until it settles.
    refetchInterval: (query) =>
      query.state.data?.photos.some((p) => p.status === 'quarantine' || p.status === 'processing')
        ? 1500
        : false,
  });
}

function imageForm(image: PickedImage): FormData {
  const form = new FormData();
  if (Platform.OS === 'web') {
    form.append('file', image.file as Blob, image.fileName ?? 'photo.jpg');
  } else {
    form.append('file', {
      uri: image.uri,
      name: image.fileName ?? 'photo.jpg',
      type: image.mimeType ?? 'image/jpeg',
    } as unknown as Blob);
  }
  return form;
}

export function useAddAlbumPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (image: PickedImage) => {
      if (Platform.OS === 'web' && !image.file) {
        image = { ...image, file: (await (await fetch(image.uri)).blob()) as File };
      }
      return apiFetch<Photo>('/v1/me/album/photos', { method: 'POST', body: imageForm(image) });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: albumKey }),
  });
}

export function useRemoveAlbumPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/me/photos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: albumKey }),
  });
}

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

/** "See my profile as others do" (phase 44): always fresh, as it's opened after editing. */
export function useProfilePreview() {
  return useQuery({
    queryKey: ['profilePreview'],
    queryFn: () => apiFetch<ProfilePreview>('/v1/me/preview'),
    staleTime: 0,
    gcTime: 0,
  });
}

/** "My visibility" (phase 70): everything that limits who can find me, and why. */
export function useMyVisibility() {
  return useQuery({
    queryKey: ['myVisibility'],
    queryFn: () => apiFetch<MyVisibility>('/v1/me/visibility'),
    staleTime: 0,
  });
}

function useDiscoveryMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () =>
      Promise.all(
        // A decision also clears "Maybe later" (phase 33); a block changes Blocked people (35).
        [
          discoveryKeys.picks,
          discoveryKeys.likes,
          discoveryKeys.matches,
          ['saved'],
          blockedKey,
        ].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}

/** Focus mode (phase 20): how many people are waiting for my reply. */
export const yourTurnKey = ['your-turn'] as const;
export function useYourTurn() {
  return useQuery({
    queryKey: yourTurnKey,
    queryFn: () => apiFetch<YourTurn>('/v1/me/your-turn'),
    refetchOnMount: 'always',
  });
}

export const useInteract = () =>
  useDiscoveryMutation((input: InteractionInput) =>
    apiFetch<{ matched: boolean; matchId: string | null }>('/v1/interactions', {
      method: 'POST',
      body: json(input),
    }),
  );
const savedKey = ['saved'] as const;

/** "Maybe later" (phase 33): profiles put aside without deciding. */
export function useSaved() {
  return useQuery({
    queryKey: savedKey,
    queryFn: async () => (await apiFetch<{ profiles: PublicProfile[] }>('/v1/saved')).profiles,
  });
}

export function useSaveForLater() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) =>
      apiFetch('/v1/saved', { method: 'POST', body: json({ targetId }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: savedKey }),
  });
}

export function useRemoveSaved() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) =>
      apiFetch(`/v1/saved/${encodeURIComponent(targetId)}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: savedKey }),
  });
}

/** Undo the last pass (phase 29b): the server returns the profile to show again. */
export const useUndoPass = () =>
  useMutation({
    mutationFn: () => apiFetch<UndoPassResult>('/v1/interactions/undo', { method: 'POST' }),
  });
export const useBlock = () =>
  useDiscoveryMutation((userId: string) =>
    apiFetch('/v1/blocks', { method: 'POST', body: json({ userId }) }),
  );

/** Blocked people (phase 35): name only, newest first. */
export const blockedKey = ['blocked'] as const;
export function useBlocked() {
  return useQuery({
    queryKey: blockedKey,
    queryFn: async () => (await apiFetch<{ blocked: BlockedPerson[] }>('/v1/blocks')).blocked,
  });
}
/** Unblock: they may appear in decks again; a match the block closed stays closed. */
export const useUnblock = () =>
  useDiscoveryMutation((userId: string) =>
    apiFetch(`/v1/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
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

// ---------------------------------------------------------------- travel mode (phase 18c)

export const travelKey = ['travel'] as const;

export function useTravel() {
  return useQuery({
    queryKey: travelKey,
    queryFn: async () => (await apiFetch<{ travel: TravelState }>('/v1/me/travel')).travel,
  });
}

/** City search runs on the community's own server (a bundled list), never a geocoding service. */
export function usePlaces(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['places', q],
    queryFn: async () =>
      (await apiFetch<{ places: Place[] }>(`/v1/places?q=${encodeURIComponent(q)}`)).places,
    enabled: q.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
}

function useTravelMutation<TInput>(request: (input: TInput) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async () => {
      for (const queryKey of [travelKey, discoveryKeys.discover, discoveryKeys.picks]) {
        await client.invalidateQueries({ queryKey, refetchType: 'all' });
      }
    },
  });
}
export const useStartTravel = () =>
  useTravelMutation((input: TravelInput) =>
    apiFetch('/v1/me/travel', { method: 'PUT', body: json(input) }),
  );
export const useEndTravel = () =>
  useTravelMutation(() => apiFetch('/v1/me/travel', { method: 'DELETE' }));
