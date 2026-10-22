// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { magicLinkEmail } from '../src/lib/mailer.js';

describe('emails', () => {
  it('end with the software credit in both languages (license term, see NOTICE)', () => {
    const mail = magicLinkEmail('Ahava', 'https://api.example.org/auth?token=x');
    expect(mail.text).toContain('מופעל על ידי NexaHeart · קוד פתוח · nexaheart.com');
    expect(mail.text.trimEnd().endsWith('Powered by NexaHeart · Open source · nexaheart.com')).toBe(
      true,
    );
    expect(mail.html).toContain('Powered by NexaHeart · Open source · nexaheart.com');
    // The sign-in link stays the only link in the email.
    expect(mail.html.match(/<a /g)).toHaveLength(2);
  });
});
