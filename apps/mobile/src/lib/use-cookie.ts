// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useEffect, useState } from 'react';
import { authHeaders } from './auth-client';

/** Session cookie for native image requests (empty on web, where the browser sends it). */
export function useSessionCookie(): string | undefined {
  const [cookie, setCookie] = useState<string>();
  useEffect(() => {
    void authHeaders().then((h) => setCookie(h.cookie));
  }, []);
  return cookie;
}
