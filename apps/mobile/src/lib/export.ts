import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { authHeaders } from './auth-client';
import { API_URL } from './config';

export type ExportResult = 'done' | 'rate_limited' | 'error';

const fileName = () => `my-data-${new Date().toISOString().slice(0, 10)}.zip`;

/**
 * Downloads the member's data export (GET /v1/me/export). Web: a normal browser download.
 * Native: saved to the app's private cache and handed to the system share sheet (save to Files…).
 * On Android the share target may still be reading the file when shareAsync returns, so the cached
 * copy is removed at the start of the next export (and the OS may purge the cache at any time).
 */
export async function downloadMyData(): Promise<ExportResult> {
  const url = `${API_URL}/v1/me/export`;
  if (Platform.OS === 'web') {
    const res = await fetch(url, { credentials: 'include' }).catch(() => null);
    if (!res) return 'error';
    if (res.status === 429) return 'rate_limited';
    if (!res.ok) return 'error';
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return 'done';
  }

  const dir = new Directory(Paths.cache, 'export');
  try {
    if (dir.exists) dir.delete();
    dir.create();
    const target = new File(dir, fileName());
    const file = await File.downloadFileAsync(url, target, {
      headers: await authHeaders(),
      idempotent: true,
    });
    await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive' });
    return 'done';
  } catch (e) {
    return /\b429\b/.test(String(e)) ? 'rate_limited' : 'error';
  }
}
