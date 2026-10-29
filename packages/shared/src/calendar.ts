// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).

/**
 * "Add to calendar" (phase 42): one event as an iCalendar file (RFC 5545), made on the device.
 * Text is escaped, lines end in CRLF and are folded at 75 octets, times are UTC.
 */
export interface CalendarEvent {
  /** Stable, so adding the same event twice updates it instead of duplicating it. */
  uid: string;
  start: Date;
  end: Date;
  title: string;
  location?: string;
  description?: string;
}

/** A date without an end time is put in the calendar for this long. */
export const DATE_CALENDAR_HOURS = 2;

const escapeText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const utc = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Folds a content line at 75 octets (UTF-8), never inside a character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // The first line holds 75 octets; continuation lines start with a space, so 74 more.
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function icsFile(event: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NexaHeart//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(event.start)}`,
    `DTEND:${utc(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
