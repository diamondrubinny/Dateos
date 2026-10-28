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

/** Account activity (phase 31): the member's own security events, newest first. */
export const accountActivityKinds = [
  'signed_in',
  'device_signed_out',
  'signed_out_others',
  'data_downloaded',
] as const;
export const ACCOUNT_ACTIVITY_DAYS = 90;
export const accountActivitySchema = z.object({
  events: z.array(
    z.object({
      kind: z.enum(accountActivityKinds),
      at: z.string(),
      /** For a sign-in: the coarse device (as in "Your devices"). */
      device: signedInDeviceSchema.shape.device.nullable(),
      /** For "signed out everywhere else": how many devices. */
      count: z.number().int().nullable(),
    }),
  ),
});
export type AccountActivity = z.infer<typeof accountActivitySchema>;
