import { describe, expect, it } from "vitest";
import {
  healingEffectColor,
  MAX_ACTIVE_WORLD_EFFECTS,
  questSiteFeedback,
  shouldFloatEvent,
} from "../src/client/game/feedback.js";

describe("world feedback readability", () => {
  it("keeps only spatial combat outcomes above actors", () => {
    expect(shouldFloatEvent("combat.hit")).toBe(true);
    expect(shouldFloatEvent("heal.received")).toBe(true);
    for (const code of [
      "loot.picked",
      "quest.progress",
      "quest.site_wrong",
      "presence.lost",
      "zone.transition",
    ] as const) {
      expect(shouldFloatEvent(code)).toBe(false);
    }
    expect(MAX_ACTIVE_WORLD_EFFECTS).toBeLessThanOrEqual(32);
  });

  it("never reveals the expected puzzle site before interaction", () => {
    expect(questSiteFeedback(true, 40)).toEqual({ signalAlpha: 0, labelAlpha: 0.9 });
    expect(questSiteFeedback(true, 300)).toEqual({ signalAlpha: 0, labelAlpha: 0 });
    expect(questSiteFeedback(false, 40)).toEqual({ signalAlpha: 0, labelAlpha: 0 });
  });

  it("keeps the caster colour for healing VFX and safely rejects malformed values", () => {
    expect(healingEffectColor("ember")).toBe("ember");
    expect(healingEffectColor("violet")).toBe("violet");
    expect(healingEffectColor("yellow")).toBe("azure");
    expect(healingEffectColor(undefined)).toBe("azure");
  });
});
