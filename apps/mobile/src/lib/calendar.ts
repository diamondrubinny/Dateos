// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { icsFile, type CalendarEvent } from '@nexaheart/shared';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * "Add to calendar" (phase 42): the .ics file is made here, on the device; nothing is sent to the
 * server or to a calendar service. Web: a download the browser opens with the calendar app.
 * Native: the system share sheet (Calendar, Files…). 📘 expo-file-system / expo-sharing docs.
 */
export async function addToCalendar(event: CalendarEvent, fileName: string): Promise<boolean> {
  const text = icsFile(event);
  const name = `${fileName.replace(/[^\w-]+/g, '-').slice(0, 40) || 'event'}.ics`;
  try {
    if (Platform.OS === 'web') {
      const href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      return true;
    }
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
    await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar', UTI: 'com.apple.ical.ics' });
    return true;
  } catch {
    return false;
  }
}
