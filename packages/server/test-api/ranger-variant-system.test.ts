import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { talentEffect } from "@lindocara/engine/talents.js";
import { startCombatAction } from "@lindocara/server/world/combat-action-system.js";
import { isPlayerInvulnerable } from "@lindocara/server/world/combat-system.js";
import {
  advanceAdditionalVolleys,
  applyCometExplosion,
  focusedVolleyPowerRatio,
  linePiercerPowerRatio,
  retreatShotDirections,
  scheduleAdditionalVolleys,
  swornPreyTarget,
  windstepCanInterrupt,
} from "@lindocara/server/world/ranger-variant-system.js";
import { newPlayer, type PlayerRuntime } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it, vi } from "vitest";

const DASH_PREREQUISITES = [
  "ranger.dash.distance",
  "ranger.dash.evasion",
  "ranger.dash.readiness",
] as const;

function ranger(id: string, talents: readonly string[]): PlayerRuntime {
  return newPlayer(
    {
      id,
      nick: id,
      x: 0,
      y: 0,
      z: 0,
      level: 10,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "ranger",
      equipment: starterEquipmentFor("ranger"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
      talents: [...talents],
    },
    `${id}-connection`,
    "verdant-reach:main",
  );
}

describe("authoritative ranger evolution systems", () => {
  it("increases Perce-ligne only after each distinct prior target and caps the bonus", () => {
    const effect = talentEffect(
      "ranger",
      ["ranger.piercing_arrow.line_piercer"],
      "line_piercer",
      2,
    );
    if (!effect) throw new Error("missing Linebreaker effect");
    expect(linePiercerPowerRatio(1, effect)).toBe(1);
    expect(linePiercerPowerRatio(2, effect)).toBe(1.15);
    expect(linePiercerPowerRatio(5, effect)).toBe(1.6);
    expect(linePiercerPowerRatio(50, effect)).toBe(1.6);
  });

  it("diminishes repeated Volée concentrée impacts without reducing its first arrow", () => {
    const effect = talentEffect("ranger", ["ranger.volley.focused"], "focused_volley", 3);
    if (!effect) throw new Error("missing Focused Volley effect");
    expect(focusedVolleyPowerRatio(1, effect)).toBe(1);
    expect(focusedVolleyPowerRatio(2, effect)).toBe(0.78);
    expect(focusedVolleyPowerRatio(3, effect)).toBeCloseTo(0.56);
    expect(focusedVolleyPowerRatio(20, effect)).toBe(0.35);
  });

  it("fires Tir de repli as a stable three-arrow fan without losing purchased dash immunity", () => {
    const retreat = ranger("retreat", [...DASH_PREREQUISITES, "ranger.dash.retreat_shot"]);
    const effect = talentEffect("ranger", retreat.talents, "retreat_shot", 4);
    if (!effect) throw new Error("missing Retreat Shot effect");
    const directions = retreatShotDirections({ x: 1, z: 0 }, effect);
    expect(directions).toHaveLength(3);
    expect(directions[1]).toEqual({ x: 1, z: 0 });
    expect(directions.every((direction) => direction.x > 0)).toBe(true);

    const windstep = ranger("windstep", [...DASH_PREREQUISITES, "ranger.dash.mastery"]);
    for (const actor of [retreat, windstep]) {
      startCombatAction(actor, {
        kind: "skill",
        skillId: "dash",
        slot: 4,
        direction: { x: 1, y: 0 },
        now: 1_000,
        anticipationMs: 0,
        recoveryMs: 500,
      });
    }
    expect(isPlayerInvulnerable(windstep, 1_001)).toBe(true);
    expect(isPlayerInvulnerable(retreat, 1_001)).toBe(true);
    expect(windstepCanInterrupt(windstep.action, 1_001)).toBe(true);
    expect(windstepCanInterrupt(windstep.action, 1_500)).toBe(false);
  });

  it("explodes Flèche comète in stable order without duplicating or crossing blocked targets", () => {
    const effect = talentEffect("ranger", ["ranger.heartseeker.comet_arrow"], "comet_arrow", 5);
    if (!effect) throw new Error("missing Comet Arrow effect");
    const hit = vi.fn();
    const targets = [{ id: "z" }, { id: "direct" }, { id: "blocked" }, { id: "a" }];

    expect(
      applyCometExplosion(
        targets,
        "direct",
        effect,
        (target) => target.id !== "blocked",
        (target, ratio) => hit(target.id, ratio),
      ),
    ).toBe(2);
    expect(hit.mock.calls).toEqual([
      ["a", 0.65],
      ["z", 0.65],
    ]);
  });

  it("schedules two extra Volley animations and impacts exactly 1.5 seconds apart", () => {
    const actor = ranger("triple", [
      "ranger.volley.force",
      "ranger.volley.reach",
      "ranger.volley.readiness",
      "ranger.volley.mastery",
      "ranger.volley.triple_volley",
    ]);
    const effect = talentEffect("ranger", actor.talents, "triple_volley", 3);
    if (!effect) throw new Error("missing Triple Volley effect");
    const action = startCombatAction(actor, {
      kind: "skill",
      skillId: "volley",
      slot: 3,
      direction: { x: 1, y: 0 },
      now: 1_000,
      anticipationMs: 360,
      recoveryMs: 640,
    });
    if (!action) throw new Error("volley action missing");
    actor.rangerVolleySequence = scheduleAdditionalVolleys(action, effect);
    const animate = vi.fn();
    const fire = vi.fn();

    advanceAdditionalVolleys(actor, 2_499, animate, fire);
    expect(animate).not.toHaveBeenCalled();
    advanceAdditionalVolleys(actor, 2_500, animate, fire);
    expect(animate).toHaveBeenCalledTimes(1);
    advanceAdditionalVolleys(actor, 2_860, animate, fire);
    expect(fire).toHaveBeenCalledTimes(1);
    advanceAdditionalVolleys(actor, 4_360, animate, fire);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(fire).toHaveBeenCalledTimes(2);
    expect(actor.rangerVolleySequence).toBeNull();
  });

  it("locks Sworn Prey in the facing cone using distance then id deterministically", () => {
    const actor = ranger("sworn", []);
    actor.facing = { x: 1, z: 0 };
    const candidate = (id: string, x: number) => ({ id, x, y: 0, z: 0, deadUntil: 0 });
    const result = swornPreyTarget(
      actor,
      [candidate("behind", -10), candidate("z", 80), candidate("a", 80)] as never,
      200,
      1_000,
      () => true,
    );
    expect(result?.id).toBe("a");
  });
});
