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

  it("accepts an animation before any snapshot is known", () => {
    const authority = new CombatVisualAuthority();
    expect(authority.acceptsAnimation("player-a", "action-a")).toBe(true);
  });

  it("accepts a fresh animation immediately after an authoritative null", () => {
    const authority = new CombatVisualAuthority();
    authority.recordSnapshot("player-a", null);
    expect(authority.acceptsAnimation("player-a", "action-b")).toBe(true);
  });

  it("does not let a buffered stale null erase a newer animation event", () => {
    const authority = new CombatVisualAuthority();
    expect(authority.recordSnapshot("player-a", null)).toBe(true);
    expect(authority.acceptsAnimation("player-a", "action-a")).toBe(true);

    expect(authority.recordSnapshot("player-a", null)).toBe(false);
    expect(authority.recordSnapshot("player-a", null)).toBe(false);
    expect(authority.recordSnapshot("player-a", "action-a")).toBe(true);
    expect(authority.recordSnapshot("player-a", null)).toBe(true);
  });

  it("does not let the previous snapshot action replace the next ordered animation", () => {
    const authority = new CombatVisualAuthority();
    authority.recordSnapshot("player-a", "action-a");
    expect(authority.acceptsAnimation("player-a", "action-b")).toBe(true);

    expect(authority.recordSnapshot("player-a", "action-a")).toBe(false);
    expect(authority.recordSnapshot("player-a", "action-b")).toBe(true);
  });

  it("keeps an explicitly cancelled action blocked after an authoritative null", () => {
    const authority = new CombatVisualAuthority();
    authority.recordSnapshot("monster-a", "action-a");
    expect(authority.acceptsAnimation("monster-a", "action-a")).toBe(true);
    authority.recordSnapshot("monster-a", null);
    authority.cancel("action-a");
    expect(authority.acceptsAnimation("monster-a", "action-a")).toBe(false);
  });

  it("accepts the current and next ordered animations while the snapshot still has action-a", () => {
    const authority = new CombatVisualAuthority();
    authority.recordSnapshot("monster-a", "action-a");
    expect(authority.acceptsAnimation("monster-a", "action-a")).toBe(true);
    expect(authority.acceptsAnimation("monster-a", "action-b")).toBe(true);
  });

  it("accepts a new action after the previous id was cancelled", () => {
    const authority = new CombatVisualAuthority();
    authority.recordSnapshot("player-a", null);
    authority.cancel("action-a");
    expect(authority.acceptsAnimation("player-a", "action-a")).toBe(false);
    expect(authority.acceptsAnimation("player-a", "action-b")).toBe(true);
  });

  it.each([
    "death",
    "transition",
    "reconnection",
  ])("never restores action-a after cancellation by %s", (reason) => {
    const authority = new CombatVisualAuthority();
    authority.recordSnapshot("player-a", "action-a");
    authority.cancel("action-a");
    authority.recordSnapshot("player-a", null);
    if (reason !== "death") authority.clearSnapshots();
    expect(authority.acceptsAnimation("player-a", "action-a")).toBe(false);
    expect(authority.acceptsAnimation("player-a", "action-b")).toBe(true);
  });

  it("does not couple actor cancellation to authoritative projectile snapshots", () => {
    const authority = new CombatVisualAuthority();
    const projectiles = [{ id: "projectile-a", actionId: "action-a" }];
    authority.recordSnapshot("player-a", null);
    authority.cancel("action-a");
    expect(projectiles).toEqual([{ id: "projectile-a", actionId: "action-a" }]);
  });

  it("accepts two consecutive authoritative animations without an intermediate snapshot", () => {
    const authority = new CombatVisualAuthority();
    authority.recordSnapshot("player-a", null);
    expect(authority.acceptsAnimation("player-a", "action-a")).toBe(true);
    expect(authority.acceptsAnimation("player-a", "action-b")).toBe(true);
  });
});
