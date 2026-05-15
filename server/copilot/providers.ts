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
}

export interface Provider {
  kind: ProviderKind;
  model: string;
  complete(req: CompletionRequest): Promise<string>;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function selectProvider(env: ProviderEnv, preferred?: "anthropic" | "openai"): Provider {
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(env.OPENAI_API_KEY);

  if (preferred === "openai" && hasOpenAI) return openaiProvider(env);
  if (preferred === "anthropic" && hasAnthropic) return anthropicProvider(env);

  if (hasAnthropic) return anthropicProvider(env);
  if (hasOpenAI) return openaiProvider(env);
  return stubProvider();
}

function anthropicProvider(env: ProviderEnv): Provider {
  const model = env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! });
  return {
    kind: "anthropic",
    model,
    async complete(req) {
      const resp = await client.messages.create({
        model,
        max_tokens: req.maxTokens ?? 800,
        temperature: req.temperature ?? 0.3,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return text;
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
      const resp = await client.chat.completions.create({
        model,
        max_tokens: req.maxTokens ?? 800,
        temperature: req.temperature ?? 0.3,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      });
      return resp.choices[0]?.message?.content?.trim() ?? "";
    },
  };
}

/**
 * Offline fallback. Returns a clearly-labeled stub response so the UI can render
 * something useful (retrieved snippets) even without any API key. Demos should
 * always show the user we are NOT calling a real LLM.
 */
function stubProvider(): Provider {
  return {
    kind: "stub",
    model: "stub",
    async complete(req) {
      const preview = req.user.split("\n").slice(0, 3).join(" ");
      return [
        "[stub LLM — no API key configured]",
        "",
        "Recommended thing to say:",
        `\"Based on the retrieved wiki context, here's a positioning angle for: ${preview.slice(0, 140)}\"`,
        "",
        "Why this works:",
        "- This is a placeholder. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to enable live suggestions.",
        "",
        "Sources:",
        "- (see Retrieved Context panel for grounded snippets)",
      ].join("\n");
    },
  };
}
