// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { TFunction } from 'i18next';

/** Phase 74b: "Kosher" and "Closed on Shabbat" after a place's details, as staff marked it. */
export function venueTags(
  venue: { kosher?: boolean; shabbatClosed?: boolean },
  t: TFunction,
): string {
  return [
    venue.kosher ? t('datePlan.kosher') : null,
    venue.shabbatClosed ? t('datePlan.shabbatClosed') : null,
  ]
    .filter(Boolean)
    .map((tag) => ` · ${tag}`)
    .join('');
}
