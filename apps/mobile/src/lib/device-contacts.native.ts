// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts';

export const deviceContactsAvailable = true;

/**
 * Email addresses from the address book, after the system permission prompt. Only addresses are
 * read; they're hashed on the device before anything is sent (see trust-queries).
 */
export async function readContactEmails(): Promise<string[] | 'denied'> {
  const { granted } = await requestPermissionsAsync();
  if (!granted) return 'denied';
  const details = await Contact.getAllDetails([ContactField.EMAILS] as const);
  const emails = details.flatMap((c) =>
    (c.emails ?? []).map((e) => e.address?.trim().toLowerCase() ?? ''),
  );
  return [...new Set(emails.filter((e) => e.includes('@')))];
}
