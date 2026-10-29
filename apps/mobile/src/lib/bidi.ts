// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).

/**
 * Keeps a left-to-right value (an email address, a code) in one piece inside a right-to-left
 * sentence: Unicode isolates (LRI … PDI), so punctuation around it stays where it belongs.
 */
export const ltr = (value: string) => (value ? `\u2066${value}\u2069` : value);
