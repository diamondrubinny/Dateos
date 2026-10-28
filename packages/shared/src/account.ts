// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/** "Your devices" (phase 29): where the member is signed in. No IP address or browser string. */
export const deviceKinds = ['app', 'web', 'unknown'] as const;
export type DeviceKind = (typeof deviceKinds)[number];

export const signedInDeviceSchema = z.object({
  id: z.string(),
  /** Coarse, e.g. the Android app, or Firefox on Linux; apps translate it. */
  device: z.object({
    kind: z.enum(deviceKinds),
    os: z.string().nullable(),
    browser: z.string().nullable(),
  }),
  signedInAt: z.string(),
  /** The day it was last active: sessions refresh at most daily. */
  lastActiveAt: z.string(),
  current: z.boolean(),
});
export type SignedInDevice = z.infer<typeof signedInDeviceSchema>;

export const signedInDevicesSchema = z.object({ devices: z.array(signedInDeviceSchema) });

/** A random secret the app makes once per installation; the server keeps only its hash. */
export const deviceSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{32,128}$/, 'A device secret is 32-128 url-safe characters.');
