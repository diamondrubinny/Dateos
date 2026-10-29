// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { foldLine, icsFile } from '../src/calendar.js';

const event = {
  uid: 'date-123@local',
  start: new Date('2026-11-05T17:30:00Z'),
  end: new Date('2026-11-05T19:30:00Z'),
  title: 'Coffee, then a walk; maybe',
  location: 'Café Puaa, Rabbi Yohanan St 8\nJaffa',
};

describe('icsFile', () => {
  const text = icsFile(event, new Date('2026-10-29T10:00:00.123Z'));

  it('is one VEVENT with UTC times and CRLF line ends', () => {
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('\r\nDTSTART:20261105T173000Z\r\n');
    expect(text).toContain('\r\nDTEND:20261105T193000Z\r\n');
    expect(text).toContain('\r\nDTSTAMP:20261029T100000Z\r\n');
    expect(text.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  it('escapes commas, semicolons and new lines', () => {
    expect(text).toContain('SUMMARY:Coffee\\, then a walk\\; maybe');
    expect(text).toContain('LOCATION:Café Puaa\\, Rabbi Yohanan St 8\\nJaffa');
  });

  it('leaves out what is empty', () => {
    expect(icsFile({ ...event, location: '' })).not.toContain('LOCATION');
    expect(text).not.toContain('DESCRIPTION');
  });
});

describe('foldLine', () => {
  it('folds at 75 octets without splitting a character', () => {
    const line = `SUMMARY:${'שלום '.repeat(30)}`;
    const folded = foldLine(line);
    const encoder = new TextEncoder();
    for (const part of folded.split('\r\n'))
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:Hi')).toBe('SUMMARY:Hi');
  });
});
