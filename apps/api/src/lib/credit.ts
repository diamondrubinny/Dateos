// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  CREDIT_AUTHOR,
  CREDIT_AUTHOR_URL,
  CREDIT_LICENSE,
  CREDIT_NAME,
  CREDIT_URL,
  type InstanceInfo,
} from '@nexaheart/shared';
import type { Env } from '../config/env.js';

/** The software credit every client shows (an additional term of the license, see NOTICE). */
export function poweredBy(env: Env): InstanceInfo['poweredBy'] {
  return {
    name: CREDIT_NAME,
    url: CREDIT_URL,
    license: CREDIT_LICENSE,
    sourceUrl: env.SOURCE_CODE_URL,
    author: { name: CREDIT_AUTHOR, url: CREDIT_AUTHOR_URL },
  };
}
