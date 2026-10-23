// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/** Reading the address book needs the native app; on the web people paste addresses instead. */
export const deviceContactsAvailable = false;

export async function readContactEmails(): Promise<string[] | 'denied'> {
  return [];
}
