import { describe, it, expect } from "vitest";
import { MODES, getMode, type ModeId } from "./modes.js";

describe("modes", () => {
  it("exposes the live speaker mode plus all 8 sales modes", () => {
    const ids: ModeId[] = [
      "speaker",
      "discovery",
      "demo",
      "objection",
      "competitive",
      "pricing",
      "roi",
      "followup",
      "closing",
    ];
    for (const id of ids) {
      expect(MODES[id]).toBeDefined();
      expect(MODES[id].label.length).toBeGreaterThan(0);
      expect(MODES[id].systemPrompt.length).toBeGreaterThan(20);
    }
  });

  it("each mode declares whether structured card output is required", () => {
    for (const mode of Object.values(MODES)) {
      expect(typeof mode.structured).toBe("boolean");
    }
  });

  it("getMode returns the mode by id and falls back to discovery", () => {
    expect(getMode("pricing").id).toBe("pricing");
    expect(getMode("unknown" as ModeId).id).toBe("discovery");
  });
});
