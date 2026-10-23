// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).

/** What happened in the app, for integrations (phase 24). Opaque ids only, never content. */
export type AppEvent =
  | { type: 'report.created'; reportId: string; urgent: boolean }
  | { type: 'report.resolved'; reportId: string }
  | { type: 'waitlist.joined' }
  | { type: 'member.joined'; memberId: string }
  | { type: 'member.deleted'; memberId: string }
  | { type: 'match.created'; matchId: string }
  | { type: 'event.created'; eventId: string };

/** A tiny in-process bus: listeners run in the background and can never fail a request. */
export class AppEvents {
  private readonly listeners: ((event: AppEvent) => Promise<void>)[] = [];

  on(listener: (event: AppEvent) => Promise<void>): void {
    this.listeners.push(listener);
  }

  emit(event: AppEvent): void {
    for (const listener of this.listeners) listener(event).catch(() => undefined);
  }
}

/** Services start with a bus nobody listens to (unit tests); services.ts gives them the real one. */
export const noEvents = new AppEvents();
