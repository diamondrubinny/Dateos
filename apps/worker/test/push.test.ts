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
    expect(pushContent('message', 'toString', 'Ahava').body).toBe('You have a new message');
  });
});
