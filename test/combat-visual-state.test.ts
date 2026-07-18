import { describe, expect, it } from "vitest";
import {
  CombatVisualAuthority,
  clearVisualAction,
  type MutableVisualActionState,
} from "../src/client/game/combat-visual-state.js";

describe("authoritative combat visual cancellation", () => {
  it("clears anticipation, future impact, telegraph and persistent action state immediately", () => {
    const state: MutableVisualActionState = {
      actionId: "action-a",
      actionSkillId: "radiant_bolt",
      actionStartedAt: 100,
      actionImpactAt: 380,
      actionEndsAt: 750,
      actionDirection: { x: 1, y: 0 },
      effectPlayedActionId: "action-a",
      guardVisualUntil: 2_000,
    };
    expect(clearVisualAction(state)).toBe("action-a");
    expect(state).toEqual({});
  });

  it("lets an authoritative null fence stale animation events without affecting new actions", () => {
    const authority = new CombatVisualAuthority();
    authority.recordSnapshot("monster-a", "action-a");
    expect(authority.acceptsAnimation("monster-a", "action-a")).toBe(true);
    authority.recordSnapshot("monster-a", null);
    authority.cancel("action-a");
    expect(authority.acceptsAnimation("monster-a", "action-a")).toBe(false);

    authority.recordSnapshot("monster-a", "action-b");
    expect(authority.acceptsAnimation("monster-a", "action-b")).toBe(true);
  });

  it("does not couple actor cancellation to authoritative projectile snapshots", () => {
    const authority = new CombatVisualAuthority();
    const projectiles = [{ id: "projectile-a", actionId: "action-a" }];
    authority.recordSnapshot("player-a", null);
    authority.cancel("action-a");
    expect(projectiles).toEqual([{ id: "projectile-a", actionId: "action-a" }]);
  });
});
