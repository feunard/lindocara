import type { PlayerSnapshot } from "@lindocara/engine/protocol.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import { ActorMotionTracker } from "@lindocara/renderer/actor-motion.js";
import type { ActorView, BillboardScene } from "@lindocara/renderer/hd2d/billboards.js";
import { createBillboardRegistry } from "@lindocara/renderer/hd2d/billboards.js";
import {
  monsterActorSheet,
  playerActorSheet,
  playerActorView,
} from "@lindocara/renderer/hd2d/game-renderer.js";
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
