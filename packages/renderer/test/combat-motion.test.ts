import {
  lumenStepOpacity,
  mobilityRenderOffset,
  mobilityVisual,
  scheduleShadowDanceReplay,
  shadowDancePositionAfter,
} from "@lindocara/renderer/combat-motion.js";
import { describe, expect, it } from "vitest";

describe("combat mobility presentation", () => {
  it("gives charge, dash, blink and Shadow Step distinct visual identities", () => {
    expect(
      new Set(
        ["shield_bash", "dash", "blink", "shadow_step"].map((id) => mobilityVisual(id)?.color),
      ).size,
    ).toBe(4);
    expect(mobilityVisual("shadow_step")).toMatchObject({
      durationMs: 180,
      color: 0x8050c8,
      width: 13,
    });
    expect(mobilityVisual("quick_shot")).toBeNull();
  });

  it("eases from the previous rendered position to authoritative truth", () => {
    expect(mobilityRenderOffset(-120, 30, 1_000, 200, 1_000)).toEqual({ x: -120, y: 30 });
    expect(mobilityRenderOffset(-120, 30, 1_000, 200, 1_100)).toEqual({ x: -30, y: 7.5 });
    expect(mobilityRenderOffset(-120, 30, 1_000, 200, 1_200)).toEqual({ x: 0, y: 0 });
  });

  it("softly disappears at Lumen impact and rematerializes through recovery", () => {
    expect(lumenStepOpacity(1_000, 1_200, undefined, 3_600, 1_000)).toBe(1);
    expect(lumenStepOpacity(1_000, 1_200, undefined, 3_600, 1_200)).toBeCloseTo(0.06);
    expect(lumenStepOpacity(1_000, 1_200, undefined, 3_600, 2_000)).toBeCloseTo(0.06);
    expect(lumenStepOpacity(1_000, 1_200, 2_000, 2_400, 2_200)).toBeCloseTo(0.53);
    expect(lumenStepOpacity(1_000, 1_200, 2_000, 2_400, 2_400)).toBe(1);
  });

  it("replays all five authoritative Shadow Dance teleports after a delayed receipt", () => {
    const strikes = Array.from({ length: 5 }, (_, index) => ({
      impactAt: 10_000 + index * 90,
      landing: { x: 40 + index * 32, y: 80 + index * 16 },
    }));

    const replay = scheduleShadowDanceReplay(strikes, 10_000, 10_450, 50_000);

    expect(replay.strikes.map((strike) => strike.localImpactAt)).toEqual([
      50_000, 50_090, 50_180, 50_270, 50_360,
    ]);
    expect(replay.localEndsAt).toBe(50_450);
    expect(shadowDancePositionAfter({ x: 8, y: 12 }, replay.strikes, 0)).toEqual({
      x: 8,
      y: 12,
    });
    for (let completed = 1; completed <= strikes.length; completed += 1) {
      expect(shadowDancePositionAfter({ x: 8, y: 12 }, replay.strikes, completed)).toEqual(
        strikes[completed - 1]?.landing,
      );
    }
  });
});
