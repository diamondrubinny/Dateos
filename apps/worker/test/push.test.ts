// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { pushContent } from '../src/push.js';

describe('push content', () => {
  it('is generic and localized: no names, no message text', () => {
    expect(pushContent('message', 'he', 'Ahava')).toEqual({
      title: 'Ahava',
      body: 'יש לך הודעה חדשה',
    });
    expect(pushContent('match', 'en', 'Ahava')).toEqual({
      title: 'Ahava',
      body: "It's a match! Say hello",
    });
    expect(pushContent('message', 'ar', 'Ahava').body).toBe('لديك رسالة جديدة');
    expect(pushContent('match', 'ru', 'Ahava').body).toBe('Это взаимно! Напишите привет');
    expect(pushContent('message', 'fr', 'Ahava').body).toBe('You have a new message');
    // Phase 68a: an introduction, without anyone's name.
    expect(pushContent('introduction', 'he', 'Ahava')).toEqual({
      title: 'Ahava',
      body: 'יש לך הצעת היכרות חדשה משדכנות הקהילה',
    });
    expect(pushContent('message', 'toString', 'Ahava').body).toBe('You have a new message');
  });
});

describe('discreet notifications (phase 67a)', () => {
  it('say nothing about the community or what happened, in every language', () => {
    for (const locale of ['en', 'he', 'ar', 'ru', 'fr']) {
      for (const kind of ['message', 'match', 'call', 'event', 'checkin'] as const) {
        const content = pushContent(kind, locale, 'Rainbow Club', true);
        expect(JSON.stringify(content)).not.toContain('Rainbow');
        expect(content).toEqual(pushContent('message', locale, 'Other', true));
      }
    }
    expect(pushContent('match', 'he', 'Rainbow Club', true)).toEqual({
      title: 'התראה חדשה',
      body: 'יש משהו חדש',
    });
  });
});
