import { describe, it, expect } from "vitest";
import { selectProvider, type ProviderEnv } from "./providers.js";

describe("selectProvider", () => {
  it("prefers openai when both keys are present (faster streaming for live calls)", () => {
    const env: ProviderEnv = { ANTHROPIC_API_KEY: "sk-ant-x", OPENAI_API_KEY: "sk-oai-x" };
    const p = selectProvider(env);
    expect(p.kind).toBe("openai");
  });

  it("falls back to anthropic when only ANTHROPIC_API_KEY is set", () => {
    const env: ProviderEnv = { ANTHROPIC_API_KEY: "sk-ant-x" };
    const p = selectProvider(env);
    expect(p.kind).toBe("anthropic");
  });

  it("returns a stub provider when no keys are present", () => {
    const p = selectProvider({});
    expect(p.kind).toBe("stub");
  });

  it("respects explicit preferred provider override when key exists", () => {
    const env: ProviderEnv = { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" };
    expect(selectProvider(env, "openai").kind).toBe("openai");
    expect(selectProvider(env, "anthropic").kind).toBe("anthropic");
  });

  it("ignores preferred override when its key is missing", () => {
    const env: ProviderEnv = { OPENAI_API_KEY: "y" };
    // No anthropic key, but explicitly asked for it — still has to fall back.
    expect(selectProvider(env, "anthropic").kind).toBe("openai");
  });

  it("stub provider returns a deterministic shaped response", async () => {
    const p = selectProvider({});
    const out = await p.complete({
      system: "you are a copilot",
      user: "demo",
      maxTokens: 200,
    });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
    // Stub clearly identifies itself so the UI can show "LLM disabled" affordances.
    expect(out.toLowerCase()).toContain("stub");
  });
});
