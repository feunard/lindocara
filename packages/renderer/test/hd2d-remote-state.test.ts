/**
 * A remote hero is drawn in the state its owner reported — not in the one the terrain implies.
 *
 * Since S3 moved movement to the client, a hero's elevation is a FACT its own client computed, and
 * the room relays it with the three locomotion flags beside it (`PlayerSnapshot.airborne`,
 * `swimming`, `gliding`). Placing every actor on `heightAt` regardless would silently discard that:
 * a party member's jump would never leave the ground on anyone else's screen, and a swimmer would
 * be drawn standing on the seabed. Nothing would fail — which is precisely why this suite exists.
 */

import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import type { PlayerSnapshot } from "@lindocara/engine/protocol.js";
import { billboardHeight } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { combatArt } from "../src/combat-art.js";
import type { ActorView, BillboardScene } from "../src/hd2d/billboards.js";
import {
  ACTOR_FOOT,
  createBillboardRegistry,
  GLIDER_LIFT,
  LAB_UNIT_HEIGHT,
  SWIM_DEPTH,
} from "../src/hd2d/billboards.js";
import { HD2D_GLIDER_TEXTURE_URL, playerActorView } from "../src/hd2d/game-renderer.js";
import { HD2D_CAMERA } from "../src/hd2d/scene.js";

/** A square map from a row-major list of levels — `null` is water. The billboard suite's `mapOf`,
 *  plus an explicit `waterLevel`: this suite is about the difference between the ground under an
 *  actor and the water line, so the two must be far enough apart to tell apart. */
function mapOf(size: number, levels: readonly (number | null)[], waterLevel = -0.6): MapData {
  return {
    version: 1,
    size,
    levelHeight: 0.9,
    waterLevel,
    levels: [...levels],
    materials: levels.map(() => "herbe" as TerrainMaterial),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
}

function flatMap(size: number, waterLevel = -0.6): MapData {
  return mapOf(
    size,
    Array.from({ length: size * size }, () => 0),
    waterLevel,
  );
}

function sceneFor(map: MapData): BillboardScene & { root: THREE.Scene } {
  return {
    root: new THREE.Scene(),
    query: createTerrainQuery(mapToQuerySource(map)),
    size: map.size,
    waterLevel: map.waterLevel,
  };
}

/** A registry with no bytes behind its texture — `makeBillboard` reads only `image.width/height`,
 *  which is what lets placement be exercised in jsdom without a GL context. */
function textureRegistryOf(width = 1536, height = 192): TextureRegistry {
  const texture = new THREE.Texture({ width, height } as unknown as HTMLImageElement);
  return {
    async decode() {},
    get: () => texture,
    urls: () => [],
    dispose: () => {},
  };
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  return root.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
}

/** A billboard pivots on its FEET, so the mesh sits one foot-offset below the height it stands at.
 *  Reading the drawn elevation back therefore means adding that offset in again. */
function drawnElevation(mesh: THREE.Mesh, ctx: Hd2dContext): number {
  return (
    mesh.position.y +
    ACTOR_FOOT.player *
      billboardHeight({
        height: LAB_UNIT_HEIGHT,
        pitch: HD2D_CAMERA.pitch,
        stretch: ctx.config.spriteStretch,
      })
  );
}

/** One remote hero, grounded by default. `y` is ELEVATION; `x`/`z` are the ground pair. */
function actor(overrides: Partial<ActorView> = {}): ActorView {
  return {
    id: "remote",
    kind: "player",
    x: 0.5,
    y: 0,
    z: 0.5,
    airborne: false,
    swimming: false,
    gliding: false,
    vy: 0,
    facing: "east",
    textureKey: "warrior-idle",
    ...overrides,
  };
}

function snapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: "remote",
    nick: "Aelwyn",
    x: 0.5,
    y: 0,
    z: 0.5,
    airborne: false,
    swimming: false,
    gliding: false,
    vy: 0,
    hp: 100,
    maxHp: 100,
    level: 1,
    appearance: { body: "wayfarer", primaryColor: "azure" },
    class: "warrior",
    equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
    life: "alive",
    facing: { x: 1, z: 0 },
    action: null,
    ...overrides,
  };
}

describe("a remote hero's drawn state", () => {
  it("draws an airborne hero at the elevation it reported, not on the ground under it", () => {
    const map = flatMap(4);
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());

    registry.sync([actor({ y: 2.4, airborne: true })]);

    const mesh = meshes(scene.root)[0];
    if (!mesh) throw new Error("expected a billboard");
    // The ground under this cell is 0. Snapping to it is what makes every other player's jump
    // invisible: the sprite would never leave the grass while its owner sees itself in the air.
    expect(drawnElevation(mesh, ctx)).toBeCloseTo(2.4);
  });

  it("keeps a hero under an open canopy off the ground", () => {
    const map = flatMap(4);
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());

    // `gliding` alone, without `airborne`. The rule clears the canopy the moment a hero lands, so
    // the two travel together in practice — but they are three INDEPENDENT booleans on the wire,
    // and a glider drawn on the grass is the one reading of them that is never right.
    registry.sync([actor({ y: 1.8, gliding: true })]);

    const mesh = meshes(scene.root)[0];
    if (!mesh) throw new Error("expected a billboard");
    expect(drawnElevation(mesh, ctx)).toBeCloseTo(1.8);
  });

  it("stretches on ascent, squashes on descent and restores its rest scale", () => {
    const scene = sceneFor(flatMap(4));
    const registry = createBillboardRegistry(createHd2dContext(), scene, textureRegistryOf());

    registry.sync([actor({ airborne: true, vy: 8 })]);
    const body = meshes(scene.root)[0];
    if (!body) throw new Error("expected a billboard");
    expect(body.scale.y).toBeGreaterThan(1);
    expect(body.scale.x).toBeLessThan(1);

    registry.sync([actor({ airborne: true, vy: -8 })]);
    expect(body.scale.y).toBeLessThan(1);
    expect(body.scale.x).toBeGreaterThan(1);

    registry.sync([actor({ vy: 0 })]);
    expect(body.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("creates one canopy lazily, follows the glider and hides it on close", () => {
    const scene = sceneFor(flatMap(4));
    const registry = createBillboardRegistry(createHd2dContext(), scene, textureRegistryOf());
    const glider = actor({
      y: 2,
      airborne: true,
      gliding: true,
      vy: -2.2,
      canopyTextureKey: HD2D_GLIDER_TEXTURE_URL,
    });

    registry.sync([glider]);
    const canopy = meshes(scene.root)[1];
    if (!canopy) throw new Error("expected a canopy billboard");
    expect(canopy.visible).toBe(true);
    expect(canopy.position.y).toBeCloseTo(glider.y + GLIDER_LIFT);

    registry.sync([{ ...glider, gliding: false, airborne: false, vy: 0 }]);
    expect(canopy.visible).toBe(false);
    expect(meshes(scene.root)).toHaveLength(2);
  });

  it("draws a swimmer at the water line rather than on the bed under it", () => {
    // Ground at level 0 (height 0) with the water line well below it: two elevations far enough
    // apart that "stood on the bottom" and "floating at the surface" cannot be confused.
    const map = flatMap(4, -0.6);
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());

    // The reported elevation is deliberately absurd: swimming is decided BEFORE the airborne path,
    // so a swimmer floats at the surface no matter what elevation rides beside the flag.
    registry.sync([actor({ y: 12, swimming: true })]);

    const mesh = meshes(scene.root)[0];
    if (!mesh) throw new Error("expected a billboard");
    expect(drawnElevation(mesh, ctx)).toBeCloseTo(map.waterLevel - SWIM_DEPTH);
  });

  it("draws a swimmer at the water line even when a desynced client also reports airborne", () => {
    // The two flags are mutually exclusive in `stepHero`'s own rule (water entry clears `airborne`
    // in the same assignment that sets `swimming`), so this combination should never arrive from a
    // well-behaved client. `elevationOf` still checks `swimming` first, precisely so a stale or
    // hostile client reporting both cannot float a swimmer above their own sea.
    const map = flatMap(4, -0.6);
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());

    registry.sync([actor({ y: 12, swimming: true, airborne: true })]);

    const mesh = meshes(scene.root)[0];
    if (!mesh) throw new Error("expected a billboard");
    expect(drawnElevation(mesh, ctx)).toBeCloseTo(map.waterLevel - SWIM_DEPTH);
  });

  it("still stands a walking hero on the terrain, whatever elevation rides with it", () => {
    // A 4x4 map with one raised cell at (2, 1) — the billboard suite's own fixture.
    const map = mapOf(
      4,
      Array.from({ length: 16 }, (_, k) => (k === 1 * 4 + 2 ? 1 : 0)),
    );
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());

    const query = createTerrainQuery(mapToQuerySource(map));
    const [cx, cz] = query.cellCenter(2, 1);

    // No flag set: the terrain wins, and the reported elevation — one snapshot stale, or simply a
    // hero mid-fall between two tiers — must not lift the sprite off the plateau it is standing on.
    registry.sync([actor({ x: cx, y: 0, z: cz })]);

    const mesh = meshes(scene.root)[0];
    if (!mesh) throw new Error("expected a billboard");
    expect(drawnElevation(mesh, ctx)).toBeCloseTo(map.levelHeight);
  });

  it("draws a grounded hero on the finite roof selected by its reported elevation", () => {
    const map = {
      ...flatMap(4),
      colliders: [
        {
          x: 0,
          z: 0,
          w: 1,
          h: 1,
          top: 1.8,
          support: "center" as const,
        },
      ],
    };
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());

    registry.sync([actor({ x: 0.5, y: 1.8, z: 0.65 })]);

    const mesh = meshes(scene.root)[0];
    if (!mesh) throw new Error("expected a billboard");
    expect(mesh.position.y).toBeCloseTo(1.8);
    expect((mesh.material as THREE.Material).depthTest).toBe(false);
    expect(mesh.renderOrder).toBe(6);

    registry.sync([actor({ x: -1, y: 0, z: -1 })]);
    expect((mesh.material as THREE.Material).depthTest).toBe(true);
    expect(mesh.renderOrder).toBe(0);
  });

  it("carries the snapshot's elevation and its three flags into the view the registry draws", () => {
    // The seam the two halves meet at: a flag the renderer never reads off the snapshot is a flag
    // `billboards.ts` can do nothing with, and the placement tests above would still pass.
    expect(playerActorView(snapshot({ y: 3.1, airborne: true, gliding: true }))).toMatchObject({
      id: "remote",
      kind: "player",
      x: 0.5,
      y: 3.1,
      z: 0.5,
      airborne: true,
      swimming: false,
      gliding: true,
      vy: 0,
    });

    expect(playerActorView(snapshot({ y: -0.6, swimming: true }))).toMatchObject({
      y: -0.6,
      airborne: false,
      swimming: true,
      gliding: false,
    });
  });

  it("replaces the Priest with the original Tiny Swords cloud only during Lumen Step traversal", () => {
    const action = {
      id: "lumen-step",
      kind: "skill" as const,
      skillId: "blink",
      direction: { x: 1, z: 0 },
      startedAt: 10_000,
      impactAt: 10_200,
      channelEndsAt: 11_800,
      recoveryEndsAt: 12_200,
      resolved: true,
    };
    const priest = snapshot({ class: "priest", action });
    const { channelEndsAt: _releasedAt, ...heldAction } = action;
    const cloud = combatArt("priest", "blink", "azure").impact;
    if (!cloud) throw new Error("expected the Lumen cloud");

    expect(playerActorView(priest, 199, "attack").textureKey).not.toBe(cloud.source);
    const clouded = playerActorView(priest, 200, "attack");
    expect(clouded).toMatchObject({
      textureKey: cloud.source,
      frames: 10,
      frameWidth: 64,
      frameHeight: 64,
      tint: 0xb48cff,
    });
    expect(clouded.renderHeight).toBeCloseTo(1.17);
    expect(playerActorView(priest, 1_801, "attack").textureKey).not.toBe(cloud.source);
    expect(
      playerActorView(snapshot({ class: "priest", action: heldAction }), 1_900, "attack")
        .textureKey,
    ).toBe(cloud.source);
  });
});
