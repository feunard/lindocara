import {
  CombatVisualAuthority,
  clearVisualAction,
  hasPendingAnticipation,
  type MutableVisualActionState,
  shouldShowMonsterTelegraph,
} from "@lindocara/renderer/combat-visual-state.js";
import { describe, expect, it } from "vitest";

describe("authoritative combat visual cancellation", () => {
  it("never exposes a charge telegraph for an immediate enemy projectile", () => {
    expect(hasPendingAnticipation(1_000, 1_000, 1_000)).toBe(false);
    expect(hasPendingAnticipation(1_000, 1_560, 1_100)).toBe(true);
    expect(hasPendingAnticipation(1_000, 1_560, 1_560)).toBe(false);
  });

  it("keeps delayed melee guidance but suppresses every heavy-special red telegraph", () => {
    expect(shouldShowMonsterTelegraph(undefined, 1_000, 1_560, 1_100)).toBe(true);
    expect(shouldShowMonsterTelegraph(undefined, 1_000, 1_000, 1_000)).toBe(false);
    expect(shouldShowMonsterTelegraph("troll_quake", 1_000, 2_100, 1_100)).toBe(false);
    expect(shouldShowMonsterTelegraph("fire_burst", 1_000, 1_760, 1_100)).toBe(false);
  });

  it("clears anticipation, future impact, telegraph and persistent action state immediately", () => {
    const state: MutableVisualActionState = {
      actionId: "action-a",
      actionSkillId: "radiant_bolt",
      actionStartedAt: 100,
      actionImpactAt: 380,
      actionImpactTimes: [380, 630],
      actionEndsAt: 750,
      actionDirection: { x: 1, y: 0 },
      effectPlayedActionId: "action-a",
      effectPlayedImpactCount: 2,
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

  it("plays one server-resolved special impact exactly once per action id", () => {
    const authority = new CombatVisualAuthority();
    expect(authority.acceptsImpact("quake-a")).toBe(true);
    expect(authority.acceptsImpact("quake-a")).toBe(false);
    expect(authority.acceptsImpact("quake-b")).toBe(true);
  });

  it("accepts a resolved impact even when interpolation already cancelled its actor action", () => {
    const authority = new CombatVisualAuthority();
    authority.cancel("quake-a");
    expect(authority.acceptsImpact("quake-a")).toBe(true);
    expect(authority.acceptsImpact("quake-a")).toBe(false);
  });
});
