import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type ProviderKind = "anthropic" | "openai" | "stub";

export interface ProviderEnv {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_MODEL?: string;
}

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface Provider {
  kind: ProviderKind;
  model: string;
  complete(req: CompletionRequest): Promise<string>;
  completeStream(req: CompletionRequest): AsyncIterable<string>;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function selectProvider(env: ProviderEnv, preferred?: "anthropic" | "openai"): Provider {
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(env.OPENAI_API_KEY);

  if (preferred === "openai" && hasOpenAI) return openaiProvider(env);
  if (preferred === "anthropic" && hasAnthropic) return anthropicProvider(env);

  // Default to OpenAI for live calls — gpt-4o-mini streams with sub-second TTFT.
  if (hasOpenAI) return openaiProvider(env);
  if (hasAnthropic) return anthropicProvider(env);
  return stubProvider();
}

function anthropicProvider(env: ProviderEnv): Provider {
  const model = env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! });
  return {
    kind: "anthropic",
    model,
    async complete(req) {
      const resp = await client.messages.create(
        {
          model,
          max_tokens: req.maxTokens ?? 800,
          temperature: req.temperature ?? 0.3,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
        },
        req.signal ? { signal: req.signal } : undefined,
      );
      return resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    },
    completeStream(req) {
      return (async function* () {
        const stream = client.messages.stream(
          {
            model,
            max_tokens: req.maxTokens ?? 400,
            temperature: req.temperature ?? 0.3,
            system: req.system,
            messages: [{ role: "user", content: req.user }],
          },
          req.signal ? { signal: req.signal } : undefined,
        );
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield event.delta.text;
          }
        }
      })();
    },
  };
}

function openaiProvider(env: ProviderEnv): Provider {
  const model = env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY! });
  return {
    kind: "openai",
    model,
    async complete(req) {
      const resp = await client.chat.completions.create(
        {
          model,
          max_tokens: req.maxTokens ?? 800,
          temperature: req.temperature ?? 0.3,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        },
        req.signal ? { signal: req.signal } : undefined,
      );
      return resp.choices[0]?.message?.content?.trim() ?? "";
    },
    completeStream(req) {
      return (async function* () {
        const stream = await client.chat.completions.create(
          {
            model,
            max_tokens: req.maxTokens ?? 400,
            temperature: req.temperature ?? 0.3,
            stream: true,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
          },
          req.signal ? { signal: req.signal } : undefined,
        );
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) yield delta;
        }
      })();
    },
  };
}

/**
 * Offline fallback. Returns a clearly-labeled stub response so the UI can render
 * something useful (retrieved snippets) even without any API key.
 */
function stubProvider(): Provider {
  const fallback = (req: CompletionRequest) => {
    const preview = req.user.split("\n").slice(0, 3).join(" ");
    return [
      `"Based on the wiki, here's a positioning angle for: ${preview.slice(0, 120)}"`,
      "",
      "Why: stub LLM — no API key configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY.",
    ].join("\n");
  };
  return {
    kind: "stub",
    model: "stub",
    async complete(req) { return fallback(req); },
    completeStream(req) {
      return (async function* () {
        yield fallback(req);
      })();
    },
  };
}
