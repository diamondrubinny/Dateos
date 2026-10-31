// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { ShabbatSettings, ShabbatSettingsInput } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';

const key = ['shabbat'] as const;

/** Phase 74a: Shabbat and holiday mode. */
export function useShabbat() {
  return useQuery({ queryKey: key, queryFn: () => apiFetch<ShabbatSettings>('/v1/me/shabbat') });
}

export function useSetShabbat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ShabbatSettingsInput) =>
      apiFetch<ShabbatSettings>('/v1/me/shabbat', { method: 'PUT', body: json(input) }),
    onSuccess: (settings) => client.setQueryData(key, settings),
  });
}

/** The device's time zone, for local candle lighting and nightfall. */
export const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
