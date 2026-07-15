import { describe, expect, it } from "vitest";
import {
  type CombatTarget,
  cycleMonsterTarget,
  offensiveTarget,
  resolveBasicAttackTarget,
  resolveSkillTarget,
  targetExists,
} from "../src/client/game/targeting.js";
import type { MonsterSnapshot, PlayerSnapshot } from "../src/shared/protocol.js";

const self: PlayerSnapshot = {
  id: "self",
  nick: "Mira",
  x: 100,
  y: 100,
  ack: 0,
  hp: 100,
  maxHp: 100,
  level: 1,
  appearance: { body: "wayfarer", primaryColor: "azure" },
  class: "priest",
  equipment: { mainHand: "heartwood_staff", offHand: null },
  life: "alive",
};

function monster(id: string, x: number, dead = false): MonsterSnapshot {
  return {
    id,
    kind: "goblin",
    species: "spear_goblin",
    x,
    y: 100,
    hp: dead ? 0 : 40,
    maxHp: 40,
    dead,
  };
}

describe("explicit combat targeting", () => {
  it("cycles living enemies by distance in both directions", () => {
    const monsters = [monster("far", 300), monster("dead", 105, true), monster("near", 130)];
    expect(cycleMonsterTarget(monsters, self, undefined)).toEqual({ kind: "monster", id: "near" });
    expect(cycleMonsterTarget(monsters, self, "near")).toEqual({ kind: "monster", id: "far" });
    expect(cycleMonsterTarget(monsters, self, "near", true)).toEqual({
      kind: "monster",
      id: "far",
    });
  });

  it("requires the correct unit kind only for single-target skills", () => {
    const hostile: CombatTarget = { kind: "monster", id: "enemy" };
    const friendly: CombatTarget = { kind: "player", id: "ally" };
    const guard: CombatTarget = { kind: "guard", id: "guard-west" };
    expect(resolveSkillTarget("single_damage", hostile)).toEqual({
      ok: true,
      targetId: "enemy",
    });
    expect(resolveSkillTarget("single_heal", friendly)).toEqual({
      ok: true,
      targetId: "ally",
    });
    expect(resolveSkillTarget("single_heal", guard)).toEqual({
      ok: true,
      targetId: "guard-west",
    });
    expect(resolveSkillTarget("single_heal", hostile)).toEqual({
      ok: false,
      required: "friendly",
    });
    expect(resolveSkillTarget("area_damage", null)).toEqual({ ok: true });
    expect(resolveSkillTarget("area_heal", null)).toEqual({ ok: true });
    expect(resolveSkillTarget("nova", null)).toEqual({ ok: true });
  });

  it("auto-acquires the nearest living enemy for an offensive action", () => {
    const monsters = [monster("far", 300), monster("near", 130), monster("dead", 105, true)];
    expect(offensiveTarget(monsters, self, { kind: "player", id: "ally" })).toEqual({
      kind: "monster",
      id: "near",
    });
    expect(offensiveTarget(monsters, self, { kind: "monster", id: "far" })).toEqual({
      kind: "monster",
      id: "far",
    });
  });

  it("requires an explicit in-range target for a basic attack", () => {
    const monsters = [monster("near", 130), monster("far", 400)];
    expect(resolveBasicAttackTarget(monsters, self, null, 225)).toEqual({
      ok: false,
      reason: "no_target",
    });
    expect(resolveBasicAttackTarget(monsters, self, { kind: "player", id: "ally" }, 225)).toEqual({
      ok: false,
      reason: "no_target",
    });
    expect(resolveBasicAttackTarget(monsters, self, { kind: "monster", id: "far" }, 225)).toEqual({
      ok: false,
      reason: "out_of_range",
    });
    expect(
      resolveBasicAttackTarget(monsters, self, { kind: "monster", id: "near" }, 225),
    ).toMatchObject({ ok: true, target: { id: "near" } });
  });

  it("drops a selected enemy when it dies but keeps valid friendly targets", () => {
    expect(
      targetExists({ kind: "monster", id: "dead" }, [self], [monster("dead", 105, true)]),
    ).toBe(false);
    expect(targetExists({ kind: "player", id: "self" }, [self], [])).toBe(true);
    expect(
      targetExists(
        { kind: "guard", id: "guard-west" },
        [self],
        [],
        [
          {
            id: "guard-west",
            x: 120,
            y: 100,
            hp: 220,
            maxHp: 220,
            homeX: 120,
            homeY: 100,
            fighting: false,
          },
        ],
      ),
    ).toBe(true);
  });
});
