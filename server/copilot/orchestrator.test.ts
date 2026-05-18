import { describe, it, expect, vi } from "vitest";
import { buildIndex } from "../kb/retriever.js";
import type { Chunk } from "../kb/types.js";
import { runCopilot } from "./orchestrator.js";
import type { Provider } from "./providers.js";

const sample: Chunk[] = [
  { id: "p#0", source: "wiki/Pricing.md", heading: "Pricing", text: "CoffeeAndAI offers a free tier and paid plans for teams." },
  { id: "c#0", source: "wiki/Compare.md", heading: "vs ChatGPT", text: "Unlike generic ChatGPT, CoffeeAndAI is grounded in a curated wiki and uses a concept prerequisite graph." },
  { id: "t#0", source: "wiki/Tutor.md", heading: "AI Tutor", text: "The AI tutor uses Claude with five context layers: card, prerequisites, related pages, learner profile, conversation history." },
];

function fakeProvider(text: string): Provider {
  return {
    kind: "stub",
    model: "fake",
    complete: vi.fn(async () => text),
    // eslint-disable-next-line require-yield
    completeStream: vi.fn(async function* () { yield text; }),
  };
}

describe("runCopilot", () => {
  it("retrieves wiki context and passes it to the LLM", async () => {
    const idx = buildIndex(sample, "/tmp/repo");
    const provider = fakeProvider("Recommended thing to say:\n\"...\"\n\nSources:\n- wiki/Compare.md");
    const completeSpy = provider.complete as unknown as ReturnType<typeof vi.fn>;
    const result = await runCopilot({
      mode: "objection",
      context: "How is this different from ChatGPT?",
      index: idx,
      provider,
    });
    expect(completeSpy).toHaveBeenCalledTimes(1);
    const arg = completeSpy.mock.calls[0]![0] as { user: string; system: string };
    expect(arg.system).toContain("OBJECTION HANDLING");
    expect(arg.user).toContain("How is this different from ChatGPT?");
    // Retrieved context must be embedded in the user prompt.
    expect(arg.user.toLowerCase()).toContain("wiki/compare.md");
    expect(result.text).toContain("Sources:");
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources.some((s) => s.source === "wiki/Compare.md")).toBe(true);
    expect(result.providerKind).toBe("stub");
  });

  it("works with zero retrieval hits (still calls provider, flags it)", async () => {
    const idx = buildIndex(sample, "/tmp/repo");
    const provider = fakeProvider("generic answer");
    const completeSpy = provider.complete as unknown as ReturnType<typeof vi.fn>;
    const result = await runCopilot({
      mode: "discovery",
      context: "zzzz qqqq nonsense vocabulary",
      index: idx,
      provider,
    });
    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(result.sources).toEqual([]);
    expect(result.text).toBe("generic answer");
    expect(result.grounded).toBe(false);
  });

  it("includes mode-specific system prompt", async () => {
    const idx = buildIndex(sample, "/tmp/repo");
    const provider = fakeProvider("done");
    const completeSpy = provider.complete as unknown as ReturnType<typeof vi.fn>;
    await runCopilot({ mode: "pricing", context: "how much for a team of 50?", index: idx, provider });
    const arg = completeSpy.mock.calls[0]![0] as { system: string };
    expect(arg.system).toContain("PRICING");
  });

  it("respects topK retrieval", async () => {
    const idx = buildIndex(sample, "/tmp/repo");
    const provider = fakeProvider("done");
    const result = await runCopilot({
      mode: "discovery",
      context: "tutor and pricing and compare to ChatGPT",
      index: idx,
      provider,
      topK: 2,
    });
    expect(result.sources.length).toBeLessThanOrEqual(2);
  });
});
