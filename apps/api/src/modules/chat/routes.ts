import multipart from '@fastify/multipart';
import {
  clientEventSchema,
  conversationSchema,
  ErrorCode,
  icebreakersSchema,
  localeSchema,
  MAX_AUDIO_BYTES,
  MAX_PHOTO_BYTES,
  messageCheckResultSchema,
  messageCheckSchema,
  messagesPageSchema,
  messagesQuerySchema,
  messageViewSchema,
  sendMessageSchema,
} from '@nexaheart/shared';
import { checkHarm } from '@nexaheart/ai';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { perUserLimit } from '../../plugins/security.js';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import type { Realtime } from '../../lib/realtime.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { ChatService } from './service.js';

const matchParams = z.object({ id: z.uuid() });
const ok = z.object({ ok: z.literal(true) });

/** Typing events per connection per 10 s; anything above is dropped. */
const TYPING_BURST = 20;

export interface ChatRouteOptions {
  auth: Auth;
  chat: ChatService;
  realtime: Realtime;
  allowedOrigins: string[];
  /** Ping interval; every ping re-checks the session, so a revoked session loses the socket. */
  heartbeatMs: number;
}

export const chatRoutes: FastifyPluginAsyncZod<ChatRouteOptions> = async (
  app,
  { auth, chat, realtime, allowedOrigins, heartbeatMs },
) => {
  await app.register(multipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 1 },
  });
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/conversations',
    { schema: { response: { 200: z.object({ conversations: z.array(conversationSchema) }) } } },
    async (request) => ({
      conversations: await chat.inbox(currentUser(request).id),
    }),
  );

  app.get(
    '/v1/matches/:id/messages',
    {
      schema: {
        params: matchParams,
        querystring: messagesQuerySchema,
        response: { 200: messagesPageSchema },
      },
    },
    async (request) =>
      chat.list(
        request.params.id,
        currentUser(request).id,
        request.query.before,
        request.query.limit,
      ),
  );

  app.post(
    '/v1/matches/:id/messages',
    {
      schema: {
        params: matchParams,
        body: sendMessageSchema,
        response: { 200: messageViewSchema },
      },
      config: perUserLimit(30, 60_000),
    },
    async (request) =>
      chat.send(
        request.params.id,
        currentUser(request).id,
        request.body.text,
        request.body.clientId,
      ),
  );

  app.post(
    '/v1/matches/:id/images',
    {
      schema: { params: matchParams, response: { 200: messageViewSchema } },
      config: perUserLimit(10, 60 * 60_000),
    },
    async (request) => {
      const file = await request.file();
      if (!file) throw new HttpError(400, ErrorCode.BadRequest, 'Attach one image file.');
      return chat.sendImage(request.params.id, currentUser(request).id, await file.toBuffer());
    },
  );

  app.post(
    '/v1/matches/:id/voice',
    {
      schema: { params: matchParams, response: { 200: messageViewSchema } },
      config: perUserLimit(30, 60 * 60_000),
    },
    async (request) => {
      const file = await request.file();
      if (!file) throw new HttpError(400, ErrorCode.BadRequest, 'Attach one audio file.');
      const buffer = await file.toBuffer();
      if (buffer.length > MAX_AUDIO_BYTES) {
        throw new HttpError(
          413,
          ErrorCode.PayloadTooLarge,
          'Voice messages can be up to 60 seconds.',
        );
      }
      return chat.sendVoice(request.params.id, currentUser(request).id, buffer);
    },
  );

  app.get(
    '/v1/audio/:id',
    {
      schema: {
        params: matchParams,
        querystring: z.object({ format: z.enum(['aac', 'opus']).default('aac') }),
      },
    },
    async (request, reply) => {
      const { format } = request.query;
      const object = await chat.openAudio(currentUser(request).id, request.params.id, format);
      return reply
        .type(format === 'opus' ? 'audio/webm' : 'audio/mp4')
        .header('cache-control', 'private, max-age=300')
        .send(object.body);
    },
  );

  app.post(
    '/v1/matches/:id/read',
    { schema: { params: matchParams, response: { 200: ok } } },
    async (request) => {
      await chat.markRead(request.params.id, currentUser(request).id);
      return { ok: true as const };
    },
  );

  // "Are you sure?" pre-check. Nothing is stored; bodies are never logged.
  app.post(
    '/v1/messages/check',
    {
      schema: { body: messageCheckSchema, response: { 200: messageCheckResultSchema } },
      config: perUserLimit(60, 60_000),
    },
    async (request) => checkHarm(request.body.text),
  );

  app.get(
    '/v1/matches/:id/icebreakers',
    {
      // Each call may run a (possibly paid) language model.
      config: perUserLimit(60, 24 * 60 * 60_000),
      schema: {
        params: matchParams,
        querystring: z.object({ locale: localeSchema.default('en') }),
        response: { 200: icebreakersSchema },
      },
    },
    async (request) => ({
      suggestions: await chat.suggestIcebreakers(
        request.params.id,
        currentUser(request).id,
        request.query.locale,
      ),
    }),
  );

  app.get(
    '/v1/ws',
    {
      websocket: true,
      // Cross-site WebSocket hijacking: browsers always send Origin; it must be one of ours.
      preHandler: async (request) => {
        const origin = request.headers.origin;
        if (origin && !allowedOrigins.includes(origin))
          throw new HttpError(403, ErrorCode.Forbidden, 'Origin not allowed.');
      },
    },
    (socket, request) => {
      const { id: userId, sessionId } = currentUser(request);
      const unregister = realtime.register(userId, socket);
      const online = () => realtime.touchPresence(userId).catch(() => undefined);
      void online();
      let typingBudget = TYPING_BURST;
      let alive = true;
      const refill = setInterval(() => (typingBudget = TYPING_BURST), 10_000);
      const heartbeat = setInterval(() => {
        if (!alive) return socket.terminate();
        alive = false;
        // Signed out, session revoked or expired, or account suspended: stop delivering events.
        void chat.sessionActive(sessionId, userId).then(
          (active) => {
            if (!active) socket.close(4001, 'session ended');
          },
          () => undefined, // database hiccup: keep the socket, check again next time
        );
        socket.ping();
        void online();
      }, heartbeatMs);
      socket.on('pong', () => (alive = true));
      socket.on('message', (raw: Buffer) => {
        let event;
        try {
          event = clientEventSchema.parse(JSON.parse(raw.toString('utf8')));
        } catch {
          return; // ignore malformed input
        }
        if (event.type === 'ping') return socket.send(JSON.stringify({ type: 'pong' }));
        if (typingBudget <= 0) return;
        typingBudget -= 1;
        chat.typing(event.matchId, userId).catch(() => undefined);
      });
      socket.on('close', () => {
        clearInterval(refill);
        clearInterval(heartbeat);
        unregister();
        realtime.clearPresence(userId).catch(() => undefined);
      });
    },
  );
};
