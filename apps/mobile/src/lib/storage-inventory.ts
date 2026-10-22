/**
 * Everything the app stores in the browser or on the device. Kept in one place so the
 * "Privacy & cookies" page, docs/legal/cookie-policy and the e2e check stay in sync.
 * All entries are strictly necessary or remember a choice the person made; there is no tracking.
 */
export interface StorageItem {
  name: string;
  kind: 'cookie' | 'localStorage' | 'secureStore';
  platform: 'web' | 'native';
  /** i18n key suffix under cookies.purpose / cookies.duration */
  purpose: 'session' | 'sessionCache' | 'language' | 'pushToken';
  duration: 'days30' | 'untilChanged' | 'untilSignOut';
}

export const storageInventory: StorageItem[] = [
  // On HTTPS the browser stores it as "__Secure-dateos.session_token" (HttpOnly, Secure, SameSite=Lax).
  {
    name: 'dateos.session_token',
    kind: 'cookie',
    platform: 'web',
    purpose: 'session',
    duration: 'days30',
  },
  {
    name: 'dateos.locale',
    kind: 'localStorage',
    platform: 'web',
    purpose: 'language',
    duration: 'untilChanged',
  },
  {
    name: 'dateos_cookie',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'session',
    duration: 'days30',
  },
  {
    name: 'dateos_session_data',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'sessionCache',
    duration: 'untilSignOut',
  },
  {
    name: 'dateos.locale',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'language',
    duration: 'untilChanged',
  },
  {
    name: 'dateos.pushToken',
    kind: 'secureStore',
    platform: 'native',
    purpose: 'pushToken',
    duration: 'untilSignOut',
  },
];
