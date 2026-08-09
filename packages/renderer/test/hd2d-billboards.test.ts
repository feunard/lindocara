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
import { ACTOR_FOOT, createBillboardRegistry, LAB_UNIT_HEIGHT } from "../src/hd2d/billboards.js";
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
  it("creates one billboard per actor and reuses it across frames", () => {
    const map = flatMap(4);
    const scene = sceneFor(map);
    const registry = createBillboardRegistry(createHd2dContext(), scene, textureRegistryOf());

    registry.sync([actor("a", -1, -1), actor("b", 0, 0)]);
    expect(meshes(scene.root)).toHaveLength(2);
    const first = meshes(scene.root);

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
