import type { Database } from '@nexaheart/db';
import { CALL_RING_SECONDS, type RealtimeEvent } from '@nexaheart/shared';
import { sql } from 'drizzle-orm';

export interface CallJobContext {
  db: Database;
  /** Closes the LiveKit room, disconnecting both people (null when calls are not configured). */
  deleteRoom: ((room: string) => Promise<void>) | null;
  publish: (userId: string, event: RealtimeEvent) => Promise<void>;
  now?: () => Date;
}

/**
 * Runs every 15 seconds: an unanswered invitation becomes "Missed call" after CALL_RING_SECONDS,
 * a call ends at the community's time limit, and (a safety net for the API's own hang-up) any
 * open call of a chat that was closed ends. Each call moves at most once (status guard).
 */
export async function processCalls(
  ctx: CallJobContext,
): Promise<{ missed: number; ended: number }> {
  const now = ctx.now?.() ?? new Date();
  const moved = await ctx.db.execute<{
    id: string;
    match_id: string;
    caller_id: string;
    callee_id: string;
    room: string;
    status: 'missed' | 'ended';
  }>(sql`
    UPDATE calls c
    SET status = (CASE WHEN c.status = 'ringing' THEN 'missed' ELSE 'ended' END)::call_status,
        ended_at = ${now}
    FROM matches m
    WHERE m.id = c.match_id AND c.status IN ('ringing', 'active') AND (
      (c.status = 'ringing' AND c.created_at < ${new Date(now.getTime() - CALL_RING_SECONDS * 1000)})
      OR (c.status = 'active' AND c.answered_at + make_interval(mins => c.max_minutes) <= ${now})
      OR m.unmatched_at IS NOT NULL)
    RETURNING c.id, c.match_id, c.caller_id, c.callee_id, c.room, c.status`);
  for (const call of moved.rows) {
    await ctx.deleteRoom?.(call.room).catch(() => undefined);
    const message = await ctx.db.execute<{ id: string }>(
      sql`SELECT id FROM messages WHERE call_id = ${call.id}`,
    );
    for (const userId of [call.caller_id, call.callee_id]) {
      await ctx
        .publish(userId, {
          type: 'call.updated',
          matchId: call.match_id,
          callId: call.id,
          status: call.status,
        })
        .catch(() => undefined);
      if (message.rows[0]) {
        await ctx
          .publish(userId, {
            type: 'message.updated',
            matchId: call.match_id,
            messageId: message.rows[0].id,
          })
          .catch(() => undefined);
      }
    }
  }
  return {
    missed: moved.rows.filter((c) => c.status === 'missed').length,
    ended: moved.rows.filter((c) => c.status === 'ended').length,
  };
}
