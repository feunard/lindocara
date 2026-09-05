import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { billboardHeight } from "@lindocara/hd2d/billboard.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { ActorView, BillboardScene } from "../src/hd2d/billboards.js";
import {
  ACTOR_FOOT,
  createBillboardRegistry,
  healthBarFillColor,
  healthBarFillRatio,
  LAB_UNIT_HEIGHT,
} from "../src/hd2d/billboards.js";
import { HD2D_CAMERA } from "../src/hd2d/scene.js";

/** A square map from a row-major list of levels — `null` is water. Same shape as the terrain
 *  suite's `mapOf`, trimmed to what a billboard needs (levels, scale, nothing authored). */
function mapOf(size: number, levels: readonly (number | null)[]): MapData {
  return {
    version: 1,
    size,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: [...levels],
    materials: levels.map(() => "herbe" as TerrainMaterial),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
}

/** A `size`x`size` map, entirely ground at level 0. */
function flatMap(size: number): MapData {
  return mapOf(
    size,
    Array.from({ length: size * size }, () => 0),
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

/**
 * A texture registry with no bytes in it: `makeBillboard` clones the texture and drives its
 * `offset`/`repeat`, and reads nothing but `image.width`/`image.height` off it — which is exactly
 * what lets this suite run in jsdom without a GL context, the same move as `hd2d-scene.test.ts`.
 *
 * 1536x192 is `Warrior_Idle.png`'s real shape: eight 192px frames in one row.
 */
function textureRegistryOf(width = 1536, height = 192): TextureRegistry {
  const texture = new THREE.Texture({ width, height } as unknown as HTMLImageElement);
  return {
    async decode() {},
    get: () => texture,
    urls: () => [],
    dispose: () => {},
  };
}

/** Every mesh currently parented to the scene root — one per live billboard. */
function meshes(root: THREE.Object3D): THREE.Mesh[] {
  return root.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
}

/** The centre of cell `(i, j)` in the very units a SNAPSHOT now carries: tile units, grid centre as
 *  origin — the scene's own coordinates, read from the scene's own query so an actor and the
 *  terrain under it cannot be measured against two different rulers. */
function cellCentre(map: MapData, i: number, j: number): { x: number; z: number } {
  const query = createTerrainQuery(mapToQuerySource(map));
  const [cx, cz] = query.cellCenter(i, j);
  return { x: cx, z: cz };
}

/** A GROUNDED actor — the case this suite is about. What the three locomotion flags do when one of
 *  them is set is `hd2d-remote-state.test.ts`'s subject; here they stay false so every placement
 *  below still reads the terrain, exactly as it did before the flags existed. */
function actor(id: string, x: number, z: number): ActorView {
  return {
    id,
    kind: "player",
    x,
    y: 0,
    z,
    airborne: false,
    swimming: false,
    gliding: false,
    vy: 0,
    facing: "east",
    textureKey: "warrior-idle",
  };
}

describe("the billboard registry", () => {
  it("addresses wrapped directional strips and retains the anatomical contact across a mirror", () => {
    const scene = sceneFor(flatMap(4)),
      ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf(1600, 1000));
    const pose: ActorView = {
      ...actor("packed", 0, 0),
      frames: 32,
      sheetColumns: 16,
      directionStride: 32,
      directionRows: 5,
      frameWidth: 100,
      frameHeight: 100,
      frame: 3,
      mirroredPhaseOffset: 0.5,
      directionalFacing: { x: 1, z: 0 },
      renderHeight: 1.2,
      foot: 0.8,
    };
    registry.sync([pose]);
    const mesh = meshes(scene.root)[0];
    if (!mesh || !(mesh.material instanceof THREE.MeshLambertMaterial) || !mesh.material.map)
      throw new Error("Expected mapped billboard");
    const map = mesh.material.map;
    expect(map.repeat.x).toBeCloseTo(1 / 16);
    expect(map.repeat.y).toBeCloseTo(1 / 10);
    expect(map.offset.x).toBeCloseTo(3 / 16);
    expect(map.offset.y).toBeCloseTo(0.5);
    registry.sync([{ ...pose, directionalFacing: { x: -1, z: 0 } }]);
    expect(meshes(scene.root)[0]).toBe(mesh);
    expect(map.repeat.x).toBeCloseTo(-1 / 16);
    expect(map.offset.x).toBeCloseTo(4 / 16);
    expect(map.offset.y).toBeCloseTo(0.4);
    registry.dispose();
  });
  it("keeps an authoritative enemy health bar above its billboard", () => {
    const scene = sceneFor(flatMap(4));
    const registry = createBillboardRegistry(createHd2dContext(), scene, textureRegistryOf());
    const enemy: ActorView = {
      ...actor("enemy", 0, 0),
      kind: "monster",
      healthBar: { value: 50, max: 100, visible: true },
    };

    registry.sync([enemy]);
    const bar = scene.root.getObjectByName("enemy-health-bar");
    if (!(bar instanceof THREE.Group)) throw new Error("expected enemy health bar");
    const fill = bar.children[1];
    if (!(fill instanceof THREE.Mesh) || !(fill.material instanceof THREE.MeshBasicMaterial))
      throw new Error("expected enemy health fill");
    expect(bar.position.y).toBeGreaterThan(2);
    expect(fill.scale.x).toBeCloseTo(0.5);
    expect(fill.material.color.getHex()).toBe(0xf0b85a);

    registry.sync([{ ...enemy, healthBar: { value: 20, max: 100, visible: false } }]);
    expect(bar.visible).toBe(false);
    expect(fill.material.color.getHex()).toBe(0xe85454);
    registry.dispose();
    expect(scene.root.getObjectByName("enemy-health-bar")).toBeUndefined();
  });

  it("clamps malformed or overfilled health values before drawing", () => {
    expect(healthBarFillRatio(120, 100)).toBe(1);
    expect(healthBarFillRatio(-10, 100)).toBe(0);
    expect(healthBarFillRatio(10, 0)).toBe(0);
    expect(healthBarFillColor(0.8)).toBe(0x65d17d);
    expect(healthBarFillColor(0.5)).toBe(0xf0b85a);
    expect(healthBarFillColor(0.2)).toBe(0xe85454);
  });

  it("creates one billboard per actor and reuses it across frames", () => {
    const map = flatMap(4);
    const scene = sceneFor(map);
    const registry = createBillboardRegistry(createHd2dContext(), scene, textureRegistryOf());

    registry.sync([actor("a", -1, -1), actor("b", 0, 0)]);
    expect(meshes(scene.root)).toHaveLength(2);
    const first = meshes(scene.root);
    expect(registry.objectsFor(["b", "missing", "a"])).toEqual([first[1], first[0]]);
    expect(first[0]?.userData.actorId).toBe("a");
    expect(first[1]?.userData.actorId).toBe("b");

    // A second frame with the same two actors, moved: the same two meshes, moved — not two more.
    registry.sync([actor("a", -0.5, -1), actor("b", 0, 0.5)]);
    expect(meshes(scene.root)).toHaveLength(2);
    expect(new Set(meshes(scene.root))).toEqual(new Set(first));
  });

  it("removes the billboard of an actor that left the view", () => {
    const map = flatMap(4);
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());

    const leaverX = 0;
    const survivorX = -1;
    registry.sync([actor("a", survivorX, -1), actor("b", leaverX, 0)]);
    // Identify the LEAVER before it leaves, by the position only it has, and watch its geometry:
    // `THREE.BufferGeometry.dispose()` dispatches a `dispose` event, so this observes the real call
    // rather than trusting that removal implies it.
    const leaver = meshes(scene.root).find((mesh) => Math.abs(mesh.position.x - leaverX) < 1e-6);
    if (!leaver) throw new Error("expected actor b's billboard");
    let geometryDisposed = false;
    leaver.geometry.addEventListener("dispose", () => {
      geometryDisposed = true;
    });

    registry.sync([actor("a", survivorX, -1)]);

    // Gone from the scene AND given back. A departed actor that keeps its geometry is a leak the
    // scene graph would never show — and one still sitting in the context's registry is worse:
    // `setYaw` would go on rotating a destroyed mesh at every camera turn (see
    // `unregisterBillboard`).
    const survivors = meshes(scene.root);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.position.x).toBeCloseTo(survivorX);
    expect(geometryDisposed).toBe(true);
    expect(ctx.billboards()).not.toContain(leaver);
    expect(ctx.billboards()).toContain(survivors[0]);

    // ...and `dispose()` does the same for everything left.
    let survivorDisposed = false;
    survivors[0]?.geometry.addEventListener("dispose", () => {
      survivorDisposed = true;
    });
    registry.dispose();
    expect(meshes(scene.root)).toHaveLength(0);
    expect(survivorDisposed).toBe(true);
    expect(ctx.billboards()).toHaveLength(0);
  });

  it("places an actor on the ground height under its position", () => {
    // A 4x4 map with one raised cell, at (2, 1).
    const levels = Array.from({ length: 16 }, (_, k) => (k === 1 * 4 + 2 ? 1 : 0));
    const map = mapOf(4, levels);
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());

    const low = cellCentre(map, 0, 0);
    const high = cellCentre(map, 2, 1);
    registry.sync([actor("low", low.x, low.z), actor("high", high.x, high.z)]);

    const [lowMesh, highMesh] = meshes(scene.root);
    if (!lowMesh || !highMesh) throw new Error("expected two billboards");

    // The horizontal placement is the snapshot's own coordinate, straight through: the grid is
    // centred on the origin and so is the wire, so a cell centre is a cell centre with nothing
    // converted between them.
    expect(lowMesh.position.x).toBeCloseTo(-1.5);
    expect(lowMesh.position.z).toBeCloseTo(-1.5);
    expect(highMesh.position.x).toBeCloseTo(0.5);
    expect(highMesh.position.z).toBeCloseTo(-0.5);

    // ...and the vertical placement is the ground under that point. `placeAt` pivots a billboard on
    // its FEET, so the mesh sits one foot-offset below the ground it stands on.
    const foot =
      ACTOR_FOOT.player *
      billboardHeight({
        height: LAB_UNIT_HEIGHT,
        pitch: HD2D_CAMERA.pitch,
        stretch: ctx.config.spriteStretch,
      });
    expect(lowMesh.position.y + foot).toBeCloseTo(0);
    expect(highMesh.position.y + foot).toBeCloseTo(map.levelHeight);
  });

  it("keeps an underground NPC on its authored floor instead of snapping it to the surface", () => {
    const map = flatMap(4);
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());
    const npc: ActorView = {
      ...actor("basement-npc", 0, 0),
      kind: "event",
      y: -2.4,
      undergroundDepth: 1,
    };

    registry.sync([npc]);
    const mesh = meshes(scene.root)[0];
    if (!mesh) throw new Error("expected an underground NPC billboard");
    const foot =
      ACTOR_FOOT.event *
      billboardHeight({
        height: LAB_UNIT_HEIGHT,
        pitch: HD2D_CAMERA.pitch,
        stretch: ctx.config.spriteStretch,
      });
    expect(mesh.position.y + foot).toBeCloseTo(-2.4);

    const raised = mapOf(
      4,
      Array.from({ length: 16 }, () => 1),
    );
    const raisedScene = sceneFor(raised);
    const raisedRegistry = createBillboardRegistry(
      createHd2dContext(),
      raisedScene,
      textureRegistryOf(),
    );
    raisedRegistry.sync([{ ...actor("surface-npc", 0, 0), kind: "event" }]);
    const raisedMesh = meshes(raisedScene.root)[0];
    if (!raisedMesh) throw new Error("expected a surface NPC billboard");
    expect(raisedMesh.position.y + foot).toBeCloseTo(raised.levelHeight);
  });

  it.each([
    { surface: "building roof", terrainLevel: 0, platformTop: 1.3 },
    { surface: "bridge deck", terrainLevel: null, platformTop: 0 },
  ])("keeps a grounded actor's painted feet directly on a $surface", (fixture) => {
    const map = mapOf(
      4,
      Array.from({ length: 16 }, () => fixture.terrainLevel),
    );
    map.colliders = [{ x: -0.5, z: -0.5, w: 1, h: 1, top: fixture.platformTop }];
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());

    registry.sync([{ ...actor("platform-player", 0, 0), y: fixture.platformTop }]);

    const mesh = meshes(scene.root)[0];
    if (!mesh) throw new Error("expected a platform actor billboard");
    const footOffset =
      ACTOR_FOOT.player *
      billboardHeight({
        height: LAB_UNIT_HEIGHT,
        pitch: HD2D_CAMERA.pitch,
        stretch: ctx.config.spriteStretch,
      });
    expect(mesh.position.y + footOffset).toBeCloseTo(fixture.platformTop);
    expect((mesh.material as THREE.Material).depthTest).toBe(false);
  });

  it("fully occludes a sea guardian while its body passes below a bridge platform", () => {
    const map = mapOf(
      4,
      Array.from({ length: 16 }, () => null),
    );
    map.colliders = [{ x: -1, z: -0.5, w: 2, h: 1, top: 1.8 }];
    const scene = sceneFor(map);
    const registry = createBillboardRegistry(createHd2dContext(), scene, textureRegistryOf());
    const shark: ActorView = {
      ...actor("shark", 0, 0),
      kind: "sea_guardian",
      y: map.waterLevel,
      swimming: true,
      waterDepth: 0.48,
      renderHeight: 3.4,
    };

    registry.sync([shark]);
    const mesh = registry.objectsFor([shark.id])[0];
    if (!mesh) throw new Error("expected sea guardian billboard");
    expect(mesh.visible).toBe(false);

    registry.sync([{ ...shark, x: 1.75 }]);
    expect(mesh.visible).toBe(true);
  });

  it("turns an actor the way the snapshot faces it", () => {
    const scene = sceneFor(flatMap(4));
    const registry = createBillboardRegistry(createHd2dContext(), scene, textureRegistryOf());

    /** A flip is a NEGATIVE horizontal repeat on the sprite's own texture clone (`bindSheet`). */
    const flipped = (): boolean => {
      const mesh = meshes(scene.root)[0];
      if (!mesh) throw new Error("expected a billboard");
      const material = mesh.material as THREE.MeshLambertMaterial;
      return (material.map?.repeat.x ?? 0) < 0;
    };

    registry.sync([{ ...actor("a", -1, -1), facing: "east" }]);
    expect(flipped()).toBe(false);

    registry.sync([{ ...actor("a", -1, -1), facing: "west" }]);
    expect(flipped()).toBe(true);

    // The Tiny Swords units are profile-only: `north`/`south` have no frames of their own, so they
    // must LEAVE the current profile alone rather than snap the sprite back to east. This is also
    // what makes `facingOf`'s zero-vector answer safe.
    registry.sync([{ ...actor("a", -1, -1), facing: "north" }]);
    expect(flipped()).toBe(true);
    registry.sync([{ ...actor("a", -1, -1), facing: "south" }]);
    expect(flipped()).toBe(true);
  });
});
