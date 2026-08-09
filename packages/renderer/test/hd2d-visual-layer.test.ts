import type { PlayerSnapshot } from "@lindocara/engine/protocol.js";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Hd2dScene } from "../src/hd2d/scene.js";
import { Hd2dVisualLayer } from "../src/hd2d/visual-layer.js";

function harness(
  size = 20,
  surfaceY = 0,
): {
  canvas: HTMLCanvasElement;
  layer: Hd2dVisualLayer;
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
  return { canvas, layer: new Hd2dVisualLayer(scene, canvas, size) };
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
        { t: "entree-eau", x: 0, y: 0, z: 0, rupture: false },
      ],
      hero,
    );

    expect(layer.diagnostics().effects).toBe(3);
    layer.dispose();
  });

  it("keeps swimming and cracked-ice surfaces synchronized with local state", () => {
    const { layer } = harness();
    layer.syncLocalHero(
      { ...hero, swimming: true },
      { iceCrack: { x: 0, z: 0 }, breath: 7, maxBreath: 10, swimming: true },
      1_000,
    );

    expect(layer.diagnostics().movementSurfaces).toBe(3);
    expect(layer.diagnostics().effects).toBe(1);
    layer.syncLocalHero(
      hero,
      { iceCrack: null, breath: 10, maxBreath: 10, swimming: false },
      1_100,
    );
    expect(layer.diagnostics().movementSurfaces).toBe(0);
    layer.dispose();
  });
});
