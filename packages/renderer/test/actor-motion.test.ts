import type { PlayerSnapshot } from "@lindocara/engine/protocol.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import { ACTOR_FRAME_MS, ActorMotionTracker } from "@lindocara/renderer/actor-motion.js";
import type { ActorView, BillboardScene } from "@lindocara/renderer/hd2d/billboards.js";
import { createBillboardRegistry, directionalFrame } from "@lindocara/renderer/hd2d/billboards.js";
import {
  monsterActorSheet,
  playerActorSheet,
  playerActorView,
  SEA_GUARDIAN_DIVE_CYCLE_MS,
  SEA_GUARDIAN_SWIM_DOWN_TEXTURE_URL,
  SEA_GUARDIAN_SWIM_TEXTURE_URL,
  SEA_GUARDIAN_SWIM_UP_TEXTURE_URL,
  seaGuardianPresentation,
  seaGuardianSwimTextureUrl,
} from "@lindocara/renderer/hd2d/game-renderer.js";
import { priestSkillActiveFrame, PRIEST_MANIFEST } from "@lindocara/renderer/priest-art.js";
import {
  assassinSkillActiveFrame,
  peasantBonusSkillActiveFrame,
  rangerBonusSkillActiveFrame,
} from "@lindocara/renderer/tiny-swords-art.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

describe("actor motion tracking", () => {
  it("distinguishes idle, movement and authoritative attack", () => {
    const tracker = new ActorMotionTracker();

    expect(tracker.sample("hero", 0, 0, false, 0).motion).toBe("idle");
    expect(tracker.sample("hero", 0.2, 0, false, 16)).toEqual({
      motion: "run",
      direction: { x: 1, z: 0 },
    });
    expect(tracker.sample("hero", 0.2, 0, true, 32).motion).toBe("attack");
    expect(tracker.sample("hero", 0.2, 0, false, 600).motion).toBe("idle");
  });

  it("drops actors absent from the current frame", () => {
    const tracker = new ActorMotionTracker();
    tracker.sample("gone", 0, 0, false, 0);
    tracker.retain(new Set());

    expect(tracker.sample("gone", 1, 0, false, 16).motion).toBe("idle");
  });
});

describe("actor animation art", () => {
  const player = {
    class: "warrior",
    appearance: { body: "wayfarer", primaryColor: "azure" },
    action: null,
    facing: { x: 1, z: 0 },
  } as PlayerSnapshot;

  it("provides distinct idle, run and attack strips for heroes and monsters", () => {
    expect(
      new Set(
        (["idle", "run", "attack"] as const).map(
          (motion) => playerActorSheet(player, motion).source,
        ),
      ).size,
    ).toBe(3);
    expect(
      new Set(
        (["idle", "run", "attack"] as const).map(
          (motion) => monsterActorSheet("spear_goblin", motion).source,
        ),
      ).size,
    ).toBe(3);
  });

  it("marks attack strips as one-shot animations with their authored foot line", () => {
    const view = playerActorView(player, 120, "attack", 400);
    const sheet = playerActorSheet(player, "attack");

    expect(view.textureKey).toBe(sheet.source);
    expect(view.animationLoop).toBe(false);
    expect(view.animationDurationMs).toBe(400);
    expect(view.foot).toBeCloseTo(sheet.footOffset / sheet.frameHeight);
  });

  it("uses each skill's authored caster strip", () => {
    const guarding = {
      ...player,
      action: { skillId: "iron_guard" },
    } as PlayerSnapshot;

    expect(playerActorSheet(guarding, "attack").source).toContain("Warrior_Guard.png");
  });

  it("keeps the Runic Guardian's coherent directional bake across every motion", () => {
    const bonus = {
      ...player,
      appearance: { body: "runic_guardian", primaryColor: "azure" },
      action: { skillId: "iron_guard" },
    } as PlayerSnapshot;

    for (const motion of ["idle", "run", "attack"] as const) {
      const sheet = playerActorSheet(bonus, motion);
      expect(sheet.source).toContain("runic-guardian");
      expect(sheet.frames).toBe(motion === "run" ? 4 : 8);
      expect(sheet.frameWidth).toBe(192);
      expect(sheet.frameHeight).toBe(192);
      expect(sheet.directionRows).toBe(5);
    }
    const view = playerActorView(bonus);
    expect(view.directionalFacing).toEqual({ x: 1, z: 0 });
    expect(view.renderHeight).toBeCloseTo(2.6 * 0.92);
    expect(playerActorView(bonus, 0, "run").frameDurationMs).toBe(125);
  });

  it("runs through the Runic Guardian's charge instead of planting its feet", () => {
    const charging = {
      ...player,
      appearance: { body: "runic_guardian", primaryColor: "azure" },
      action: { skillId: "shield_bash" },
    } as PlayerSnapshot;

    expect(playerActorSheet(charging, "attack").source).toContain("runic-guardian/run.png");
  });

  it("keeps ten directional phases and a semantic strip for every Assassin skill", () => {
    const bonus = {
      ...player,
      class: "rogue",
      appearance: { body: "assassin", primaryColor: "violet" },
    } as PlayerSnapshot;

    for (const motion of ["idle", "run", "attack"] as const) {
      const sheet = playerActorSheet(bonus, motion);
      const current = {
        ...bonus,
        appearance: { ...bonus.appearance, body: "assassin_v2" },
      } as PlayerSnapshot;
      expect(sheet).toEqual(playerActorSheet(current, motion));
      expect(sheet.source).toContain("assassin-v2");
    }

    const skills = [
      "dual_slash",
      "shadow_step",
      "vanish",
      "poisoned_shiv",
      "shadow_dance",
    ] as const;
    const sources = skills.map(
      (skillId) =>
        playerActorSheet({ ...bonus, action: { skillId } } as PlayerSnapshot, "attack").source,
    );
    expect(new Set(sources).size).toBe(skills.length);
    expect(sources).toEqual(
      skills.map((skillId) => expect.stringContaining(skillId.replaceAll("_", "-"))),
    );
    expect(skills.map(assassinSkillActiveFrame)).toEqual([4, 6, 6, 6, 4]);

    const view = playerActorView(bonus, 0, "run");
    expect(view.directionalFacing).toEqual({ x: 1, z: 0 });
    const current = {
      ...bonus,
      appearance: { ...bonus.appearance, body: "assassin_v2" },
    } as PlayerSnapshot;
    expect(view).toEqual(playerActorView(current, 0, "run"));
    expect(playerActorView(bonus, 0, "idle")).toEqual(playerActorView(current, 0, "idle"));
  });

  it("keeps the animated Peasant coherent through tools, skills, cargo, and locomotion", () => {
    const bonus = {
      ...player,
      class: "peasant",
      appearance: { body: "peasant", primaryColor: "moss" },
    } as PlayerSnapshot;

    for (const motion of ["idle", "run", "attack"] as const) {
      const sheet = playerActorSheet(bonus, motion);
      expect(sheet.source).toContain("bonus/peasant");
      expect(sheet.frames).toBe(motion === "run" ? 48 : 10);
      expect(sheet.frameWidth).toBe(192);
      expect(sheet.frameHeight).toBe(192);
      expect(sheet.directionRows).toBe(5);
    }

    const skills = [
      "woodcutters_swing",
      "prospectors_pick",
      "butchers_cut",
      "makeshift_camp",
      "homemade_bomb",
    ] as const;
    const sources = skills.map(
      (skillId) =>
        playerActorSheet({ ...bonus, action: { skillId } } as PlayerSnapshot, "attack").source,
    );
    expect(new Set(sources).size).toBe(skills.length);
    expect(sources).toEqual([
      expect.stringContaining("axe.png"),
      expect.stringContaining("rally.png"),
      expect.stringContaining("ration-throw.png"),
      expect.stringContaining("camp-build.png"),
      expect.stringContaining("bomb-throw.png"),
    ]);
    expect(skills.map(peasantBonusSkillActiveFrame)).toEqual([6, 4, 6, 6, 6]);

    for (const tool of ["axe", "pickaxe", "knife"] as const) {
      const sheet = playerActorSheet(
        {
          ...bonus,
          action: { skillId: "woodcutters_swing", peasantTool: tool },
        } as PlayerSnapshot,
        "attack",
      );
      expect(sheet.source).toContain(`${tool}.png`);
    }
    for (const kind of ["gold", "meat", "wood"] as const) {
      for (const motion of ["idle", "run"] as const) {
        const sheet = playerActorSheet(
          { ...bonus, peasantCarry: { kind } } as PlayerSnapshot,
          motion,
        );
        expect(sheet.source).toContain(`carry-${kind}-${motion}.png`);
        expect(sheet.directionRows).toBe(5);
      }
    }

    const runView = playerActorView(bonus, 0, "run");
    const runFrameDurationMs = runView.frameDurationMs ?? Number.NaN;
    expect(runView.directionalFacing).toEqual({ x: 1, z: 0 });
    expect(runView.renderHeight).toBeCloseTo(2.6 * 0.9);
    expect(runFrameDurationMs).toBeCloseTo(2_000 / 48);
    expect(runFrameDurationMs * 48).toBeCloseTo(2_000);
    expect(playerActorView(bonus, 0, "idle").frameDurationMs).toBeCloseTo(1_000 / 3);

    const carriedRunView = playerActorView(
      { ...bonus, peasantCarry: { kind: "wood" } } as PlayerSnapshot,
      0,
      "run",
    );
    expect(carriedRunView.frameDurationMs).toBeCloseTo(1_000 / 14);
  });

  it("keeps a balanced sixteen-phase Ranger run and a semantic strip for every skill", () => {
    const bonus = {
      ...player,
      class: "ranger",
      appearance: { body: "ranger", primaryColor: "moss" },
    } as PlayerSnapshot;

    for (const motion of ["idle", "run", "attack"] as const) {
      const sheet = playerActorSheet(bonus, motion);
      expect(sheet.source).toContain("bonus/ranger");
      expect(sheet.frames).toBe(motion === "run" ? 16 : 10);
      expect(sheet.frameWidth).toBe(192);
      expect(sheet.frameHeight).toBe(192);
      expect(sheet.directionRows).toBe(5);
    }

    const skills = ["quick_shot", "piercing_arrow", "volley", "dash", "heartseeker"] as const;
    const sources = skills.map(
      (skillId) =>
        playerActorSheet({ ...bonus, action: { skillId } } as PlayerSnapshot, "attack").source,
    );
    expect(new Set(sources).size).toBe(skills.length);
    expect(sources).toEqual(
      skills.map((skillId) => expect.stringContaining(skillId.replaceAll("_", "-"))),
    );
    expect(skills.map(rangerBonusSkillActiveFrame)).toEqual([6, 6, 6, 4, 6]);

    const view = playerActorView(bonus, 0, "run");
    const runFrameDurationMs = view.frameDurationMs ?? Number.NaN;
    expect(view.directionalFacing).toEqual({ x: 1, z: 0 });
    expect(view.renderHeight).toBeCloseTo(2.6 * 0.9);
    expect(runFrameDurationMs).toBe(75);
    expect(runFrameDurationMs * 16).toBe(1_200);
    expect(playerActorView(bonus, 0, "idle").frameDurationMs).toBeCloseTo(1_000 / 3);
  });

  it("covers eight genuine orientations and a semantic clip for every Priest skill", () => {
    const bonus = {
      ...player,
      class: "priest",
      appearance: { body: "priest", primaryColor: "azure" },
    } as PlayerSnapshot;

    for (const motion of ["idle", "run", "attack"] as const) {
      const sheet = playerActorSheet(bonus, motion);
      expect(sheet.source).toContain("bonus/priest-prototype");
      expect(sheet.frameWidth).toBeLessThanOrEqual(256);
      expect(sheet.frameHeight).toBeLessThanOrEqual(256);
      expect((sheet.renderHeight ?? 0) / sheet.frameHeight).toBeCloseTo(
        1 / PRIEST_MANIFEST.pixelsPerTile,
      );
      expect(sheet.directionRows).toBe(5);
      expect(sheet.directionLayout).toBeUndefined();
    }

    const skills = ["radiant_bolt", "mend", "blink", "prayer", "divine_nova"] as const;
    const sources = skills.map(
      (skillId) =>
        playerActorSheet({ ...bonus, action: { skillId } } as PlayerSnapshot, "attack").source,
    );
    expect(new Set(sources).size).toBe(skills.length);
    expect(sources).toEqual(
      skills.map((skillId) => expect.stringContaining(skillId.replaceAll("_", "-"))),
    );
    expect(skills.map(priestSkillActiveFrame)).toEqual([10, 9, 7, 10, 13]);

    const view = playerActorView(bonus, 0, "run");
    expect(view.directionalFacing).toEqual({ x: 1, z: 0 });
    expect(view.renderHeight).toBeCloseTo(
      PRIEST_MANIFEST.clips.run.frame.height / PRIEST_MANIFEST.pixelsPerTile,
    );
    expect(view.frameDurationMs).toBe(PRIEST_MANIFEST.clips.run.durationMs / 36);
    expect(playerActorView(bonus, 0, "idle").frameDurationMs).toBe(100);
  });

  it("keeps Iron Guard's authored strip after its cast action has ended", () => {
    const guarding = { ...player, guarding: true, action: null } as PlayerSnapshot;

    expect(playerActorSheet(guarding, "attack").source).toContain("Warrior_Guard.png");
    expect(playerActorView(guarding, 500, "attack").animationLoop).toBe(true);
  });

  it("preserves the retired renderer's stealth visibility for self and party views", () => {
    const invisible = { ...player, invisible: true } as PlayerSnapshot;

    expect(playerActorView(invisible).opacity).toBe(0.06);
    expect(playerActorView(invisible, 0, "idle", undefined, true).opacity).toBe(0.28);
    expect(playerActorView({ ...player, silhouette: true } as PlayerSnapshot).opacity).toBe(0.9);
  });

  it("selects dedicated north/south shark swim sheets and keeps the side profile east/west", () => {
    expect(seaGuardianSwimTextureUrl({ x: 0, z: -1 })).toBe(SEA_GUARDIAN_SWIM_UP_TEXTURE_URL);
    expect(seaGuardianSwimTextureUrl({ x: 0, z: 1 })).toBe(SEA_GUARDIAN_SWIM_DOWN_TEXTURE_URL);
    expect(seaGuardianSwimTextureUrl({ x: 1, z: 0 })).toBe(SEA_GUARDIAN_SWIM_TEXTURE_URL);
    expect(seaGuardianSwimTextureUrl({ x: -1, z: 0 })).toBe(SEA_GUARDIAN_SWIM_TEXTURE_URL);
  });

  it("periodically submerges patrolling sharks without hiding a chase or attack", () => {
    const patrol = Array.from({ length: 140 }, (_, index) =>
      seaGuardianPresentation(
        "sea-guardian_alpha",
        "patrol",
        (index * SEA_GUARDIAN_DIVE_CYCLE_MS) / 140,
      ),
    );

    expect(Math.min(...patrol.map((sample) => sample.waterDepth))).toBeCloseTo(0.48);
    expect(Math.max(...patrol.map((sample) => sample.waterDepth))).toBeCloseTo(2.35);
    expect(Math.min(...patrol.map((sample) => sample.opacity))).toBeCloseTo(0.06);
    expect(Math.max(...patrol.map((sample) => sample.opacity))).toBe(1);
    expect(seaGuardianPresentation("sea-guardian_alpha", "chase", 9_000)).toEqual({
      waterDepth: 0.48,
      opacity: 1,
    });
    expect(seaGuardianPresentation("sea-guardian_alpha", "attack", 9_000)).toEqual({
      waterDepth: 0.18,
      opacity: 1,
    });
  });
});

describe("camera-relative directional actors", () => {
  it("selects front, quarters, side and back, mirroring the opposite half", () => {
    expect(directionalFrame({ x: 0, z: 1 }, 0)).toEqual({ row: 0, flipped: false });
    expect(directionalFrame({ x: 1, z: 1 }, 0)).toEqual({ row: 1, flipped: false });
    expect(directionalFrame({ x: 1, z: 0 }, 0)).toEqual({ row: 2, flipped: false });
    expect(directionalFrame({ x: 1, z: -1 }, 0)).toEqual({ row: 3, flipped: false });
    expect(directionalFrame({ x: 0, z: -1 }, 0)).toEqual({ row: 4, flipped: false });
    expect(directionalFrame({ x: -1, z: 1 }, 0)).toEqual({ row: 1, flipped: true });
    expect(directionalFrame({ x: -1, z: 0 }, 0)).toEqual({ row: 2, flipped: true });
    expect(directionalFrame({ x: -1, z: -1 }, 0)).toEqual({ row: 3, flipped: true });
  });

  it("reselects the view when the camera orbits", () => {
    expect(directionalFrame({ x: 1, z: 0 }, 0).row).toBe(2);
    expect(directionalFrame({ x: 1, z: 0 }, Math.PI / 2).row).toBe(0);
  });
});

describe("one-shot billboard strips", () => {
  it("hold their final frame instead of wrapping during recovery", () => {
    const root = new THREE.Scene();
    const scene = {
      root,
      query: { heightAt: () => 0 },
      size: 4,
      waterLevel: 0,
    } as unknown as BillboardScene;
    const texture = new THREE.Texture({
      width: 1536,
      height: 192,
    } as unknown as HTMLImageElement);
    const textures: TextureRegistry = {
      async decode() {},
      get: () => texture,
      urls: () => [],
      dispose() {},
    };
    const registry = createBillboardRegistry(createHd2dContext(), scene, textures);
    const actor: ActorView = {
      id: "hero",
      kind: "player",
      x: 0,
      y: 0,
      z: 0,
      airborne: false,
      swimming: false,
      gliding: false,
      vy: 0,
      facing: "east",
      textureKey: "attack",
      animationTimeMs: 200,
      animationDurationMs: 100,
      animationLoop: false,
    };
    registry.sync([actor]);
    const mesh = root.children[0] as THREE.Mesh;
    const map = (mesh.material as THREE.MeshLambertMaterial).map;
    if (!map) throw new Error("expected an actor texture");
    const held = map.offset.x;

    registry.sync([{ ...actor, animationTimeMs: 500 }]);
    expect(map.offset.x).toBe(held);
    registry.sync([{ ...actor, animationTimeMs: 100, animationLoop: true }]);
    expect(map.offset.x).not.toBe(held);
    registry.dispose();
  });
});

describe("looping strip cadence", () => {
  function harness() {
    const root = new THREE.Scene();
    const scene = {
      root,
      query: { heightAt: () => 0 },
      size: 4,
      waterLevel: 0,
    } as unknown as BillboardScene;
    // 1152x192 — the six-frame run strip the lab was tuned against.
    const texture = new THREE.Texture({
      width: 1152,
      height: 192,
    } as unknown as HTMLImageElement);
    const textures: TextureRegistry = {
      async decode() {},
      get: () => texture,
      urls: () => [],
      dispose() {},
    };
    const registry = createBillboardRegistry(createHd2dContext(), scene, textures);
    const base: ActorView = {
      id: "hero",
      kind: "player",
      x: 0,
      y: 0,
      z: 0,
      airborne: false,
      swimming: false,
      gliding: false,
      vy: 0,
      facing: "east",
      textureKey: "run",
      animationTimeMs: 0,
      animationLoop: true,
    };
    return { registry, root, base };
  }

  /** Which frame index the registry actually drew, read back off the texture offset. */
  function frameAt(
    registry: ReturnType<typeof createBillboardRegistry>,
    root: THREE.Scene,
    actor: ActorView,
    elapsed: number,
  ): number {
    registry.sync([{ ...actor, animationTimeMs: elapsed }]);
    const mesh = root.children[0] as THREE.Mesh;
    const map = (mesh.material as THREE.MeshLambertMaterial).map;
    if (!map) throw new Error("expected an actor texture");
    return Math.round(map.offset.x * 6);
  }

  it("runs at the lab's 12 fps, not at the idle cadence", () => {
    const { registry, root, base } = harness();
    const actor = { ...base, frameDurationMs: ACTOR_FRAME_MS.run };
    // One second of running is twelve frames: on a six-frame strip that is two full cycles, so the
    // strip is back on frame 0. At the old shared 145 ms it would only have reached frame 6 % 6 —
    // also 0 — so the midpoints below are what actually separate the two cadences.
    expect(frameAt(registry, root, actor, 0)).toBe(0);
    expect(frameAt(registry, root, actor, 1_000 / 12)).toBe(1);
    expect(frameAt(registry, root, actor, 500)).toBe(0);
    // 250 ms in: three frames at 12 fps, but only one at the old 145 ms cadence.
    expect(frameAt(registry, root, actor, 250)).toBe(3);
    registry.dispose();
  });

  it("idles slower than it runs, at the lab's 7 fps", () => {
    const { registry, root, base } = harness();
    expect(ACTOR_FRAME_MS.idle).toBeGreaterThan(ACTOR_FRAME_MS.run);
    const idle = { ...base, frameDurationMs: ACTOR_FRAME_MS.idle };
    expect(frameAt(registry, root, idle, 250)).toBe(1);
    registry.dispose();
  });

  it("falls back to the idle cadence when no motion was named", () => {
    const { registry, root, base } = harness();
    // Being wrong towards idle is the safe direction: a slightly slow idle reads as calm, a slow
    // run reads as skating.
    expect(frameAt(registry, root, base, 250)).toBe(1);
    registry.dispose();
  });
});
