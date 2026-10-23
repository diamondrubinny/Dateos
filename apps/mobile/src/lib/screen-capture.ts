// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Screenshot protection (phase 21). A browser can't block screenshots, so on the web this does
 * nothing, and Settings says so honestly. The native version is in screen-capture.native.ts.
 */
export function useNoScreenCapture(): void {}

export const screenCaptureBlocked = false;
