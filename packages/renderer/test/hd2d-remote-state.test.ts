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
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { billboardHeight } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ActorView, BillboardScene } from "../src/hd2d/billboards.js";
import { ACTOR_FOOT, createBillboardRegistry } from "../src/hd2d/billboards.js";
import { playerActorView } from "../src/hd2d/game-renderer.js";
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
        height: 192 / TILE_SIZE,
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
    expect(drawnElevation(mesh, ctx)).toBeCloseTo(map.waterLevel);
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
    });

    expect(playerActorView(snapshot({ y: -0.6, swimming: true }))).toMatchObject({
      y: -0.6,
      airborne: false,
      swimming: true,
      gliding: false,
    });
  });
});
