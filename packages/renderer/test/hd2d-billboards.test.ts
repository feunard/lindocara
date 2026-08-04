import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
// Both directions of the bridge, from the ONE module that owns the arithmetic — the same
// `tileToPixel` the server calls to put these pixels on the wire. Asserting against a local copy of
// its formula would assert nothing at all.
import { pixelToTile, tileToPixel } from "@lindocara/engine/hd2d/tile-pixel-bridge.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { billboardHeight } from "@lindocara/hd2d/billboard.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ActorView, BillboardScene } from "../src/hd2d/billboards.js";
import { ACTOR_FOOT, createBillboardRegistry } from "../src/hd2d/billboards.js";
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

/** The world-space centre of cell `(i, j)` expressed the way a SNAPSHOT expresses it: game pixels,
 *  top-left origin, through the very `tileToPixel` the server uses to write them. */
function pixelCentre(map: MapData, i: number, j: number): { x: number; y: number } {
  const query = createTerrainQuery(mapToQuerySource(map));
  const [cx, cz] = query.cellCenter(i, j);
  return { x: tileToPixel(cx, map.size), y: tileToPixel(cz, map.size) };
}

function actor(id: string, x: number, y: number): ActorView {
  return { id, kind: "player", x, y, facing: "east", textureKey: "warrior-idle" };
}

describe("the billboard registry", () => {
  it("creates one billboard per actor and reuses it across frames", () => {
    const map = flatMap(4);
    const scene = sceneFor(map);
    const registry = createBillboardRegistry(createHd2dContext(), scene, textureRegistryOf());

    registry.sync([actor("a", 64, 64), actor("b", 128, 128)]);
    expect(meshes(scene.root)).toHaveLength(2);
    const first = meshes(scene.root);

    // A second frame with the same two actors, moved: the same two meshes, moved — not two more.
    registry.sync([actor("a", 96, 64), actor("b", 128, 160)]);
    expect(meshes(scene.root)).toHaveLength(2);
    expect(new Set(meshes(scene.root))).toEqual(new Set(first));
  });

  it("removes the billboard of an actor that left the view", () => {
    const map = flatMap(4);
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const registry = createBillboardRegistry(ctx, scene, textureRegistryOf());

    registry.sync([actor("a", 64, 64), actor("b", 128, 128)]);
    // Identify the LEAVER before it leaves, by the position only it has, and watch its geometry:
    // `THREE.BufferGeometry.dispose()` dispatches a `dispose` event, so this observes the real call
    // rather than trusting that removal implies it.
    const leaverX = pixelToTile(128, 4);
    const survivorX = pixelToTile(64, 4);
    const leaver = meshes(scene.root).find((mesh) => Math.abs(mesh.position.x - leaverX) < 1e-6);
    if (!leaver) throw new Error("expected actor b's billboard");
    let geometryDisposed = false;
    leaver.geometry.addEventListener("dispose", () => {
      geometryDisposed = true;
    });

    registry.sync([actor("a", 64, 64)]);

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

    const low = pixelCentre(map, 0, 0);
    const high = pixelCentre(map, 2, 1);
    registry.sync([actor("low", low.x, low.y), actor("high", high.x, high.y)]);

    const [lowMesh, highMesh] = meshes(scene.root);
    if (!lowMesh || !highMesh) throw new Error("expected two billboards");

    // The horizontal placement is the pixel->tile conversion, and it is the whole point: the grid
    // is centred on the origin, the snapshot's pixels are not.
    expect(lowMesh.position.x).toBeCloseTo(-1.5);
    expect(lowMesh.position.z).toBeCloseTo(-1.5);
    expect(highMesh.position.x).toBeCloseTo(0.5);
    expect(highMesh.position.z).toBeCloseTo(-0.5);

    // ...and the vertical placement is the ground under that point. `placeAt` pivots a billboard on
    // its FEET, so the mesh sits one foot-offset below the ground it stands on.
    const foot =
      ACTOR_FOOT.player *
      billboardHeight({
        height: 192 / TILE_SIZE,
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

    registry.sync([{ ...actor("a", 64, 64), facing: "east" }]);
    expect(flipped()).toBe(false);

    registry.sync([{ ...actor("a", 64, 64), facing: "west" }]);
    expect(flipped()).toBe(true);

    // The Tiny Swords units are profile-only: `north`/`south` have no frames of their own, so they
    // must LEAVE the current profile alone rather than snap the sprite back to east. This is also
    // what makes `facingOf`'s zero-vector answer safe.
    registry.sync([{ ...actor("a", 64, 64), facing: "north" }]);
    expect(flipped()).toBe(true);
    registry.sync([{ ...actor("a", 64, 64), facing: "south" }]);
    expect(flipped()).toBe(true);
  });

  it("round-trips pixelToTile against tileToPixel", () => {
    // Not just the scale: the ORIGIN. `tileToPixel` shifts a grid-centred coordinate to a top-left
    // one; an inverse that only divided by TILE_SIZE would typecheck, pass a scale-only assertion,
    // and put every actor half a map from the ground under its feet.
    for (const size of [1, 4, 33, 64]) {
      for (const tile of [-size / 2, -1.5, 0, 0.25, size / 2]) {
        expect(pixelToTile(tileToPixel(tile, size), size)).toBeCloseTo(tile);
      }
    }
    // The half-map shift, spelled out once rather than only implied by the round trip: the grid's
    // own origin is the CENTRE of the pixel world, never its corner.
    expect(pixelToTile(0, 64)).toBe(-32);
    expect(pixelToTile(64 * TILE_SIZE, 64)).toBe(32);
    expect(pixelToTile(32 * TILE_SIZE, 64)).toBe(0);
  });
});
