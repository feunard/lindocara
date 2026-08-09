import type { WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";
import { SheepFeedbackTracker } from "../src/game/sheep-feedback.js";

function sheep(hits: number, state: "intact" | "depleted" = "intact"): WorldEventSnapshot {
  return {
    id: "sheep-1",
    col: 6,
    row: 5,
    graphicAssetId:
      state === "depleted" ? null : "resource.terrain-resources-meat-sheep.sheep-idle",
    graphicTint: 0xffffff,
    onTop: false,
    moveSpeed: 2,
    moveFrequency: 2,
    moveAnimation: true,
    directionFixed: false,
    presentation: "native",
    harvest: {
      state,
      generation: 0,
      hits,
      hitsRequired: 4,
      lastHitAt: hits === 0 ? null : hits * 100,
      depletedAt: state === "depleted" ? hits * 100 : null,
      respawnAt: state === "depleted" ? 300_000 : null,
      exhaustionBehavior: "hide",
      exhaustedAssetId: null,
      fadeDurationMs: 450,
      collider: state === "intact" ? [-0.375, -0.22, 0.75, 0.44] : null,
    },
  };
}

describe("authoritative sheep feedback", () => {
  it("does not replay a welcome, bleats on confirmed hits, then explodes only on the final hit", () => {
    const tracker = new SheepFeedbackTracker();
    tracker.reset(12, [sheep(0)]);
    expect(tracker.sync([sheep(0)])).toEqual([]);
    expect(tracker.sync([sheep(1)])).toEqual([
      { type: "bleat", eventId: "sheep-1", hit: 1, x: 0.5, z: -0.5 },
    ]);
    expect(tracker.sync([sheep(4, "depleted")])).toEqual([
      { type: "bleat", eventId: "sheep-1", hit: 2, x: 0.5, z: -0.5 },
      { type: "bleat", eventId: "sheep-1", hit: 3, x: 0.5, z: -0.5 },
      { type: "explode", eventId: "sheep-1", x: 0.5, z: -0.5 },
    ]);
    expect(tracker.sync([sheep(4, "depleted")])).toEqual([]);
  });
});
