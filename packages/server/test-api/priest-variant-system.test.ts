import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { talentEffect } from "@lindocara/engine/talents.js";
import { BODY_RADIUS } from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  advancePolarityOrbs,
  advanceSanctuaries,
  appendLumenTrailPoint,
  applyCleanseableNegativeEffect,
  armLifeLink,
  cleanseNegativeEffect,
  emergencyMendPower,
  finishLumenTrail,
  type LumenPortalRuntime,
  type LumenTrailRuntime,
  lumenTrailTouches,
  luminousTransfigurationPower,
  mirroredLifeLinkPower,
  nearestMercyCorpse,
  novaJudgmentDamageMultiplier,
  novaSpecializationMultipliers,
  type PolarityOrbRuntime,
  polarityOrbRadius,
  type SanctuaryRuntime,
  sacredPassageTargets,
  startLumenPortal,
  startLumenTrail,
  startPolarityOrb,
  startSanctuary,
} from "@lindocara/server/world/priest-variant-system.js";
import { newPlayer, type PlayerRuntime, toProfile } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it, vi } from "vitest";

/** Original PIXEL geometry over `TILE_SIZE`, so each case stays readable in the units it was designed in. */
const t = (pixels: number): number => pixels / TILE_SIZE;

function priest(id = "priest"): PlayerRuntime {
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
      class: "priest",
      equipment: starterEquipmentFor("priest"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    `${id}-connection`,
    "verdant-reach:main",
  );
}

describe("authoritative priest evolution systems", () => {
  it("keeps Life Link bounded and gives the chosen evolution its intended strength", () => {
    const caster = priest();
    const effect = talentEffect("priest", ["priest.mend.life_link"], "life_link", 2);
    if (!effect) throw new Error("missing Life Link effect");
    armLifeLink(caster, "first", effect, 1_000, "chain");
    armLifeLink(caster, "second", effect, 1_100, "chain");
    armLifeLink(caster, "third", effect, 1_200, "chain");
    expect(caster.priestLifeLinks.map((link) => link.targetId)).toEqual(["second", "third"]);
    const chainLink = caster.priestLifeLinks[0];
    if (!chainLink) throw new Error("missing chain link");
    expect(mirroredLifeLinkPower(100, chainLink)).toBe(20);
    armLifeLink(caster, "critical", effect, 2_000, "emergency");
    expect(caster.priestLifeLinks).toHaveLength(1);
    const emergencyLink = caster.priestLifeLinks[0];
    if (!emergencyLink) throw new Error("missing emergency link");
    expect(mirroredLifeLinkPower(200, emergencyLink)).toBe(45);
  });

  it("creates one-use Lumen gates with the selected evolution duration", () => {
    const effect = talentEffect("priest", ["priest.blink.lumen_gate"], "lumen_gate", 3);
    if (!effect) throw new Error("missing Lumen Gate effect");
    const portals: LumenPortalRuntime[] = [];
    const portal = startLumenPortal(portals, {
      ownerId: "priest",
      from: { x: t(10), y: 0, z: t(20) },
      to: { x: t(90), y: 0, z: t(20) },
      effect,
      now: 1_000,
      transfiguration: true,
      healingPower: 24,
    });
    expect(portal).toMatchObject({ startedAt: 1_000, expiresAt: 7_000, healingPower: 24 });
    // The authored trigger, unchanged by the runtime's floor. A floor of `1` rather than
    // `1 / TILE_SIZE` binds here — 28 px is 0.44 tiles — and silently widens the gate's mouth
    // 2.3x, with nothing to say so. This is the assertion that would catch that.
    expect(portal.triggerRadius).toBe(t(28));
    expect(portal.triggerRadius).toBe(effect.triggerRadius);
    expect(portal.waitingForExitIds.has("priest")).toBe(true);
    portal.usedPlayerIds.add("ally");
    expect(portal.usedPlayerIds.has("ally")).toBe(true);
  });

  it("keeps a curved Sacred Passage trail active for six seconds after release", () => {
    const effect = talentEffect("priest", ["priest.blink.sacred_passage"], "sacred_passage", 3);
    if (!effect) throw new Error("missing Sacred Passage effect");
    const trails: LumenTrailRuntime[] = [];
    const trail = startLumenTrail(trails, {
      id: "trail-1",
      ownerId: "priest",
      origin: { x: t(16), z: t(16) },
      effect,
      power: 27,
      now: 1_000,
    });
    appendLumenTrailPoint(trail, { x: t(96), z: t(16) });
    appendLumenTrailPoint(trail, { x: t(96), z: t(96) });
    finishLumenTrail(trail, 2_000, effect.durationMs);

    expect(trail).toMatchObject({ startedAt: 2_000, expiresAt: 8_000, power: 27 });
    // Same trap, same guard: the authored 22 px corridor is 0.34 tiles, so a floor of one whole
    // tile would widen the healed band from 0.59 to 1.25 tiles (`lumenTrailTouches` tests
    // `width + BODY_RADIUS`).
    expect(trail.width).toBe(t(22));
    expect(trail.width).toBe(effect.width);
    // ...and the corridor's edge is where that width puts it: 0.59 tiles from the segment heals,
    // 0.65 does not. Both would pass with a one-tile floor, which is why the two lines above are
    // the discriminating ones and this pair is the behavioural witness.
    expect(lumenTrailTouches(trail, { x: t(56), z: t(16) + t(22) + BODY_RADIUS - 0.02 })).toBe(
      true,
    );
    expect(lumenTrailTouches(trail, { x: t(56), z: t(16) + t(22) + BODY_RADIUS + 0.02 })).toBe(
      false,
    );
    // Positions are body CENTRES now, so each probe is the old top-left plus half a body.
    expect(lumenTrailTouches(trail, { x: t(72 + 16), z: t(0 + 16) })).toBe(true);
    expect(lumenTrailTouches(trail, { x: t(80 + 16), z: t(72 + 16) })).toBe(true);
    expect(lumenTrailTouches(trail, { x: t(180), z: t(180) })).toBe(false);
  });

  it("advances Polarity Orb outward and back exactly once per phase", () => {
    const effect = talentEffect("priest", ["priest.divine_nova.polarity_orb"], "polarity_orb", 5);
    if (!effect) throw new Error("missing Polarity Orb effect");
    const orbs: PolarityOrbRuntime[] = [];
    const orb = startPolarityOrb(orbs, "priest", { x: 0, y: 0, z: 0 }, t(100), effect, 1_000);
    expect(polarityOrbRadius(orb, 1_450)).toBe(t(50));
    expect(polarityOrbRadius(orb, 2_350)).toBe(t(50));
    const phases: boolean[] = [];
    advancePolarityOrbs(orbs, 1_450, (_orb, _from, _to, returning) => phases.push(returning));
    advancePolarityOrbs(orbs, 1_900, (_orb, _from, _to, returning) => phases.push(returning));
    advancePolarityOrbs(orbs, 2_800, (_orb, _from, _to, returning) => phases.push(returning));
    expect(phases).toEqual([false, true, true]);
    expect(orbs).toEqual([]);
  });

  it("amplifies Secours d'urgence only at or below the bounded health threshold", () => {
    const effect = talentEffect("priest", ["priest.mend.emergency"], "emergency_mend", 2);
    if (!effect) throw new Error("missing Emergency Aid effect");
    expect(emergencyMendPower(40, 30, 100, effect)).toBe(70);
    expect(emergencyMendPower(40, 31, 100, effect)).toBe(40);
  });

  it("heals each crossed Passage sacré ally once and none without a real path crossing", () => {
    const healedIds = new Set<string>();
    const targets = [{ id: "z" }, { id: "blocked" }, { id: "a" }];
    const crossed = sacredPassageTargets(targets, healedIds, (target) => target.id !== "blocked");
    expect(crossed.map((target) => target.id)).toEqual(["a", "z"]);
    expect(sacredPassageTargets(targets, healedIds, () => true)).toEqual([{ id: "blocked" }]);
    expect(sacredPassageTargets(targets, healedIds, () => true)).toEqual([]);
    expect(sacredPassageTargets([{ id: "still" }], new Set(), () => false)).toEqual([]);
  });

  it("keeps Sanctuaire vivant fixed and advances exactly three server-tick heals", () => {
    const effect = talentEffect("priest", ["priest.prayer.mastery"], "sanctuary", 4);
    if (!effect) throw new Error("missing Living Sanctuary effect");
    const sanctuaries: SanctuaryRuntime[] = [];
    const sanctuary = startSanctuary(sanctuaries, {
      ownerId: "priest",
      x: t(40),
      y: 0,
      z: t(80),
      radius: t(120),
      power: 32,
      effect,
      now: 1_000,
    });
    const tick = vi.fn();
    advanceSanctuaries(sanctuaries, 1_999, () => true, tick);
    advanceSanctuaries(sanctuaries, 4_000, () => true, tick);
    advanceSanctuaries(sanctuaries, 5_000, () => true, tick);

    expect(tick).toHaveBeenCalledTimes(3);
    expect(tick.mock.calls.every((call) => call[0] === sanctuary)).toBe(true);
    expect(sanctuary).toMatchObject({ x: t(40), y: 0, z: t(80), radius: t(120), power: 11 });
    expect(sanctuaries).toEqual([]);
  });

  it("turns Luminous Transfiguration into a level-scaled endpoint group heal", () => {
    const effect = talentEffect("priest", ["priest.blink.mastery"], "luminous_transfiguration", 3);
    if (!effect) throw new Error("missing Luminous Transfiguration effect");
    expect(effect.radius).toBe(t(95));
    expect(luminousTransfigurationPower(1, effect)).toBe(16);
    expect(luminousTransfigurationPower(10, effect)).toBe(25);
  });

  it("limits Absolution to the supported poison effect and never persists it", () => {
    const target = priest("poisoned");
    applyCleanseableNegativeEffect(target, {
      kind: "poison",
      sourceId: "rogue",
      expiresAt: 9_000,
    });
    expect(cleanseNegativeEffect(target, "poison")).toBe(true);
    expect(cleanseNegativeEffect(target, "poison")).toBe(false);
    applyCleanseableNegativeEffect(target, {
      kind: "poison",
      sourceId: "rogue",
      expiresAt: 9_000,
    });

    const persisted = toProfile(target);
    expect(JSON.stringify(persisted)).not.toContain("negativeEffects");
    expect(newPlayer(persisted, "fresh-connection", target.roomKey).negativeEffects.size).toBe(0);
  });

  it("makes Jugement and Miséricorde exact opposite Nova specializations", () => {
    const judgment = talentEffect("priest", ["priest.divine_nova.mastery"], "nova_judgment", 5);
    const mercy = talentEffect("priest", ["priest.divine_nova.mercy"], "nova_mercy", 5);
    expect(novaSpecializationMultipliers(judgment, undefined)).toEqual({
      damage: 1.4,
      healing: 0.6,
    });
    expect(novaSpecializationMultipliers(undefined, mercy)).toEqual({
      damage: 0.6,
      healing: 1.4,
    });
    expect(novaSpecializationMultipliers(undefined, undefined)).toEqual({
      damage: 1,
      healing: 1,
    });
    expect(novaJudgmentDamageMultiplier(31, 100, judgment)).toBe(1.4);
    expect(novaJudgmentDamageMultiplier(30, 100, judgment)).toBeCloseTo(1.89);

    const candidates = [
      { id: "far", distance: 80, corpse: true },
      { id: "z-tie", distance: 20, corpse: true },
      { id: "a-tie", distance: 20, corpse: true },
      { id: "ghost", distance: 5, corpse: false },
    ];
    expect(
      nearestMercyCorpse(
        candidates,
        (candidate) => candidate.distance,
        (candidate) => candidate.corpse,
      ),
    ).toEqual({ id: "a-tie", distance: 20, corpse: true });
  });
});
