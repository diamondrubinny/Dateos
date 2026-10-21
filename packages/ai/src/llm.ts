/**
 * Minimal text-generation clients. The caller passes untrusted profile text as quoted data in the
 * user message; these clients add no tools or function calling, and return plain text or null.
 */
export interface TextModel {
  name: string;
  /** True when requests leave this server (needs the member's `ai_cloud` consent). */
  external: boolean;
  complete(request: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string | null>;
}

/** Ollama /api/chat 📘 https://github.com/ollama/ollama/blob/main/docs/api.md */
export function ollamaModel(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): TextModel {
  return {
    name: `ollama:${model}`,
    external: false,
    async complete({ system, user, temperature = 0.7, maxTokens = 200 }) {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model,
          stream: false,
          options: { temperature, num_predict: maxTokens },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { message?: { content?: string } };
      return body.message?.content ?? null;
    },
  };
}

/**
 * Any OpenAI-compatible /chat/completions endpoint (vLLM, llama.cpp server, LM Studio, or a cloud
 * service). 📘 Check your provider's data-retention terms before using an external one.
 */
export function openAiCompatibleModel(options: {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  external: boolean;
  fetchImpl?: typeof fetch;
}): TextModel {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    name: `openai:${options.model}`,
    external: options.external,
    async complete({ system, user, temperature = 0.7, maxTokens = 200 }) {
      const res = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model: options.model,
          temperature,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return body.choices?.[0]?.message?.content ?? null;
    },
  };
}
