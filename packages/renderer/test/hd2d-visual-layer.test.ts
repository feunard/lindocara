import type { PlayerSnapshot } from "@lindocara/engine/protocol.js";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Hd2dScene } from "../src/hd2d/scene.js";
import {
  AUTHORED_EFFECT_FOOT,
  AUTHORED_EFFECT_GROUND_CLEARANCE,
  centerProjectileGeometry,
  depthBiasedEffectPosition,
  editorCursorGeometry,
  Hd2dVisualLayer,
  PROJECTILE_BILLBOARD_FOOT,
  projectileBillboardAngle,
  projectileFrameIndex,
  projectileVisualLift,
} from "../src/hd2d/visual-layer.js";

function harness(
  size = 20,
  surfaceY = 0,
): {
  canvas: HTMLCanvasElement;
  layer: Hd2dVisualLayer;
  root: THREE.Scene;
} {
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    bottom: 100,
    height: 100,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 10, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const root = new THREE.Scene();
  const surface = new THREE.Plane(new THREE.Vector3(0, 1, 0), -surfaceY);
  const point = new THREE.Vector3();
  const scene = {
    camera,
    ctx: { yaw: () => 0 },
    query: { heightAt: () => 0 },
    scene: root,
    pickGround(raycaster: THREE.Raycaster) {
      const hit = raycaster.ray.intersectPlane(surface, point);
      return hit ? { x: hit.x, z: hit.z } : null;
    },
  } as unknown as Hd2dScene;
  return { canvas, layer: new Hd2dVisualLayer(scene, canvas, size), root };
}

describe("Hd2dVisualLayer screen ray", () => {
  it("projects the canvas centre onto the bounded world ground", () => {
    const { layer } = harness();
    const point = layer.screenToWorld(50, 50);

    expect(point?.x).toBeCloseTo(0);
    expect(point?.z).toBeCloseTo(0);
    layer.dispose();
  });

  it("uses the visible elevated surface instead of projecting through it onto y=0", () => {
    const { layer } = harness(20, 4);
    const point = layer.screenToWorld(50, 50);

    expect(point?.x).toBeCloseTo(0);
    expect(point?.z).toBeCloseTo(4);
    layer.dispose();
  });

  it("refuses a projected point outside the running map", () => {
    const { layer } = harness(2);

    expect(layer.screenToWorld(100, 0)).toBeNull();
    layer.dispose();
  });
});

describe("Hd2dVisualLayer hero movement", () => {
  const hero = {
    x: 0,
    y: 0,
    z: 0,
    facing: { x: 1, z: 0 },
    swimming: false,
  } as PlayerSnapshot;

  it("plays event-driven footprints, breath and water entry", () => {
    const { layer } = harness();
    layer.playHeroMovement(
      [
        { t: "trace", x: 0, z: 0, cote: 1 },
        { t: "haleine" },
        { t: "entree-eau", x: 0, y: 0, z: 0 },
      ],
      hero,
    );

    expect(layer.diagnostics().effects).toBe(3);
    layer.dispose();
  });

  it("draws swim ripples as the shared soft ring, unfogged, on their own cadence", () => {
    const { layer, root } = harness();
    const swimmer = { ...hero, swimming: true };
    const movement = { breath: 10, maxBreath: 10, swimming: true };

    layer.syncLocalHero(swimmer, movement, 1_000);
    const first = root
      .getObjectsByProperty("type", "Mesh")
      .find(
        (child): child is THREE.Mesh =>
          child instanceof THREE.Mesh &&
          child.material instanceof THREE.MeshBasicMaterial &&
          child.material.map !== null &&
          child.geometry instanceof THREE.PlaneGeometry,
      );
    if (!first) throw new Error("expected a swim ripple on the water");
    // A TEXTURED plane, not a bare `RingGeometry` annulus: the hard 40-segment hoop this used to
    // build moved on the identical curve and read as a wireframe on the water.
    expect(first.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    // And unfogged, like the lab's — otherwise a distant swimmer's rings wash into the haze.
    expect((first.material as THREE.MeshBasicMaterial).fog).toBe(false);

    // A stroke is a SOUND, not a ripple. Emitting one here too put two overlapping series on the
    // water; the 550 ms timer above owns the cadence alone.
    const before = layer.diagnostics().effects ?? 0;
    layer.playHeroMovement([{ t: "brasse" }], swimmer);
    expect(layer.diagnostics().effects).toBe(before);

    // The timer still fires: 550 ms later there is a second ring.
    layer.syncLocalHero(swimmer, movement, 1_600);
    expect(layer.diagnostics().effects).toBe(before + 1);
    layer.dispose();
  });

  it("keeps the swimming surfaces synchronized with local state", () => {
    const { layer } = harness();
    layer.syncLocalHero(
      { ...hero, swimming: true },
      { breath: 7, maxBreath: 10, swimming: true },
      1_000,
    );

    // The swim disc and the breath bar. There were three while thin ice existed and a crack decal
    // followed the hero; that mechanic is gone, and so is the surface.
    expect(layer.diagnostics().movementSurfaces).toBe(2);
    expect(layer.diagnostics().effects).toBe(1);
    layer.syncLocalHero(hero, { breath: 10, maxBreath: 10, swimming: false }, 1_100);
    expect(layer.diagnostics().movementSurfaces).toBe(0);
    layer.dispose();
  });
});

describe("Hd2dVisualLayer restored authored effects", () => {
  it("plants upright authored sheets above the terrain instead of burying their lower edge", () => {
    expect(AUTHORED_EFFECT_FOOT).toBe(0);
    expect(AUTHORED_EFFECT_GROUND_CLEARANCE).toBeGreaterThan(0);
  });

  it("projects projectile directions into the rotating billboard plane", () => {
    expect(projectileBillboardAngle({ x: 1, z: 0 }, 0)).toBeCloseTo(0);
    expect(projectileBillboardAngle({ x: 0, z: -1 }, 0)).toBeGreaterThan(0);
    expect(projectileBillboardAngle({ x: 1, z: 0 }, Math.PI / 2)).toBeLessThan(0);
  });

  it("lifts ranged sheets completely above their authoritative ground elevation", () => {
    expect(projectileVisualLift(64, 64)).toBeGreaterThan((64 / 192) * 2.6 * 0.5);
    expect(projectileVisualLift(128, 128, 0.82)).toBeGreaterThan((128 / 192) * 2.6 * 0.82 * 0.5);
    expect(projectileVisualLift(64, 64, 1, Math.PI / 2, 72)).toBeGreaterThan(72 / 64);
  });

  it("keeps every projectile direction centred on the server position", () => {
    const geometry = new THREE.PlaneGeometry(0.8, 1.2);
    geometry.translate(0, 0.6, 0);
    centerProjectileGeometry(geometry);
    geometry.computeBoundingBox();

    expect(geometry.boundingBox?.min.x).toBeCloseTo(-0.4);
    expect(geometry.boundingBox?.max.x).toBeCloseTo(0.4);
    expect(geometry.boundingBox?.min.y).toBeCloseTo(-0.6);
    expect(geometry.boundingBox?.max.y).toBeCloseTo(0.6);
    geometry.dispose();
  });

  it("does not lower a centred projectile by an actor foot offset", () => {
    expect(PROJECTILE_BILLBOARD_FOOT).toBe(0);
  });

  it("biases impacts behind a co-located target relative to the camera", () => {
    const camera = { x: 0, z: 10 };
    const target = { x: 0, z: 0 };
    const impact = depthBiasedEffectPosition(target.x, target.z, camera.x, camera.z);
    expect(Math.hypot(impact.x - camera.x, impact.z - camera.z)).toBeGreaterThan(
      Math.hypot(target.x - camera.x, target.z - camera.z),
    );
  });

  it("loops every authored projectile frame over its declared duration", () => {
    expect(projectileFrameIndex(4, 400, 0)).toBe(0);
    expect(projectileFrameIndex(4, 400, 250)).toBe(2);
    expect(projectileFrameIndex(4, 400, 400)).toBe(0);
  });

  it("keeps the inherited world-effect budget under a burst of impacts", () => {
    const { layer } = harness();
    for (let index = 0; index < 40; index += 1) layer.pulse(0, 0, 0xffffff);

    expect(layer.diagnostics().effects).toBe(28);
    layer.dispose();
  });

  // The grid draws its cells on exact unit boundaries (`col - half` .. `col + 1 - half`), so a cell
  // is 1.0 across. The cursor used to be a polar `RingGeometry(0.42, 0.5, 4)`, whose four corners
  // sit at the RADIUS — making its side 0.5 * sqrt(2) ~= 0.707, visibly smaller than the cell it
  // was meant to outline. The size the caller asks for is now the side, measured.
  it("sizes the editor cursor by cell side, not by polar radius", () => {
    const cell = editorCursorGeometry(1);
    cell.computeBoundingBox();
    const box = cell.boundingBox;
    if (!box) throw new Error("geometry has no bounding box");
    expect(box.max.x - box.min.x).toBeCloseTo(1, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(1, 5);

    // Element mode places at quarter cells, so its cursor must shrink with the unit it marks.
    const quarter = editorCursorGeometry(0.25);
    quarter.computeBoundingBox();
    const quarterBox = quarter.boundingBox;
    if (!quarterBox) throw new Error("geometry has no bounding box");
    expect(quarterBox.max.x - quarterBox.min.x).toBeCloseTo(0.25, 5);
  });
});
