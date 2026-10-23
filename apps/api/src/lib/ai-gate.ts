// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { ollamaModel, openAiCompatibleModel, type TextModel } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Env } from '../config/env.js';

export type AiAvailability = 'available' | 'needs_consent' | 'unavailable';

export function createTextModel(env: Env): TextModel | null {
  if (env.ICEBREAKERS_PROVIDER === 'ollama')
    return ollamaModel(env.OLLAMA_URL, env.OLLAMA_CHAT_MODEL);
  if (env.ICEBREAKERS_PROVIDER === 'openai' && env.OPENAI_BASE_URL && env.OPENAI_MODEL) {
    return openAiCompatibleModel({
      baseUrl: env.OPENAI_BASE_URL,
      model: env.OPENAI_MODEL,
      apiKey: env.OPENAI_API_KEY,
      external: env.OPENAI_EXTERNAL,
    });
  }
  return null;
}

/**
 * Decides per person whether text AI may be used. A model on this server is always allowed; an
 * external one only for people who opted in to `ai_cloud` (all of them, when someone else's text
 * would be sent, as for icebreakers).
 */
export class AiGate {
  constructor(
    private readonly db: Database,
    /** The model now: it can be changed in the dashboard (phase 24). */
    private readonly source: () => Promise<TextModel | null>,
  ) {}

  private async consented(userIds: string[]): Promise<boolean> {
    const rows = await this.db
      .select({ userId: schema.consents.userId, granted: schema.consents.granted })
      .from(schema.consents)
      .where(and(inArray(schema.consents.userId, userIds), eq(schema.consents.kind, 'ai_cloud')))
      .orderBy(desc(schema.consents.createdAt));
    // Latest decision per person (rows are newest first).
    const latest = new Map<string, boolean>();
    for (const r of rows) if (!latest.has(r.userId)) latest.set(r.userId, r.granted);
    return userIds.every((id) => latest.get(id) === true);
  }

  private async current(): Promise<TextModel | null> {
    // A misconfigured model (a blocked address) counts as no model.
    return this.source().catch(() => null);
  }

  async availability(...userIds: string[]): Promise<AiAvailability> {
    const model = await this.current();
    if (!model) return 'unavailable';
    if (!model.external) return 'available';
    return (await this.consented(userIds)) ? 'available' : 'needs_consent';
  }

  /** The model to use for text involving these people, or null (use the no-AI fallback). */
  async modelFor(...userIds: string[]): Promise<TextModel | null> {
    const model = await this.current();
    if (!model) return null;
    if (model.external && !(await this.consented(userIds))) return null;
    return model;
  }
}
