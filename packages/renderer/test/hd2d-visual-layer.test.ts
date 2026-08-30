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
  SKID_DWELL_MS,
  SKID_FADE_MS,
  stairPreviewGuidePositions,
} from "../src/hd2d/visual-layer.js";

function harness(
  size = 20,
  surfaceY = 0,
  liquid: "water" | "lava" = "water",
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
    query: {
      heightAt: () => 0,
      liquidAt: () => liquid,
      liquidAtElevation: () => null,
      surfaceAt: () => surfaceY,
      waterLevelAt: () => surfaceY,
      waterLevelAtElevation: () => surfaceY,
    },
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

describe("underground stair editor guide", () => {
  it("outlines the whole multi-storey slope with one crossbar per cell", () => {
    const positions = stairPreviewGuidePositions(
      [
        {
          x: -6,
          z: 2,
          width: 6,
          depth: 2,
          direction: "east",
          lowLevel: -2,
          lowHeight: -4.8,
          highHeight: 0,
        },
      ],
      0.9,
      0,
    );

    // Deux côtés + sept traverses, chaque segment contenant deux sommets XYZ.
    expect(positions).toHaveLength(9 * 2 * 3);
    expect(positions.slice(0, 6)).toEqual([-6, -4.8, 2, 0, 0, 2]);
    expect(positions.slice(-6)).toEqual([0, 0, 2, 0, 0, 4]);
  });
});

describe("Hd2dVisualLayer authored event markers", () => {
  it("does not draw a generated ground ring under native harvest scenery", () => {
    const { layer } = harness();
    const nativeHarvest = {
      id: "harvest-tree",
      col: 4,
      row: 5,
      graphicAssetId: "resource.terrain-resources-wood-trees.tree1",
      onTop: false,
      moveSpeed: 4,
      moveFrequency: 3,
      moveAnimation: true,
      directionFixed: false,
      presentation: "native" as const,
      harvest: {
        state: "intact" as const,
        generation: 0,
        hits: 0,
        hitsRequired: 3,
        lastHitAt: null,
        depletedAt: null,
        respawnAt: null,
        exhaustionBehavior: "replace" as const,
        exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-1" as const,
        fadeDurationMs: 350,
        collider: null,
      },
    };
    const sample = {
      players: [],
      seaGuardians: [],
      monsters: [],
      guards: [],
      loot: [],
      projectiles: [],
      corpses: [],
      events: [nativeHarvest],
    };
    const { harvest: _harvest, ...nativeEventWithoutHarvest } = nativeHarvest;

    layer.sync(sample, 0);
    expect(layer.diagnostics().eventMarkers).toBe(0);
    layer.sync(
      {
        ...sample,
        events: [
          {
            ...nativeHarvest,
            graphicAssetId: null,
            harvest: { ...nativeHarvest.harvest, state: "depleted" },
          },
        ],
      },
      1,
    );
    expect(layer.diagnostics().eventMarkers).toBe(0);
    layer.sync(
      {
        ...sample,
        events: [{ ...nativeEventWithoutHarvest, id: "marker", presentation: "marker" }],
      },
      2,
    );
    expect(layer.diagnostics().eventMarkers).toBe(1);
    layer.sync(
      {
        ...sample,
        events: [
          {
            ...nativeEventWithoutHarvest,
            id: "marker",
            presentation: "marker",
            showMarker: false,
          },
        ],
      },
      3,
    );
    expect(layer.diagnostics().eventMarkers).toBe(0);
    layer.dispose();
  });
});

describe("Hd2dVisualLayer event marker dust", () => {
  const markerEvent = {
    id: "door",
    col: 4,
    row: 5,
    graphicAssetId: null,
    onTop: false,
    moveSpeed: 4,
    moveFrequency: 3,
    moveAnimation: true,
    directionFixed: false,
    presentation: "marker" as const,
  };
  const empty = {
    players: [],
    seaGuardians: [],
    monsters: [],
    guards: [],
    loot: [],
    projectiles: [],
    corpses: [],
    events: [],
  };

  function motesIn(root: THREE.Scene): THREE.Points[] {
    const found: THREE.Points[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.Points) found.push(object);
    });
    return found;
  }

  /** The marker is the GROUP: a halo quad with the motes orbiting over it, and the spin lives on
   *  the group so both children turn together. */
  function markersIn(root: THREE.Scene): THREE.Object3D[] {
    const found: THREE.Object3D[] = [];
    root.traverse((object) => {
      if (object.name === "event-marker") found.push(object);
    });
    return found;
  }

  function halosIn(root: THREE.Scene): THREE.Mesh[] {
    return markersIn(root).flatMap((marker) =>
      marker.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh),
    );
  }

  it("draws each interactable as a dust ring sharing one geometry, material and texture", () => {
    const { layer, root } = harness();
    layer.sync(
      { ...empty, events: [markerEvent, { ...markerEvent, id: "chest", col: 9, row: 2 }] },
      0,
    );

    const motes = motesIn(root);
    expect(motes).toHaveLength(2);
    const [first, second] = motes;
    if (!first || !second) throw new Error("expected two markers");
    // The point of building them lazily on the layer: fifty interactables cost fifty transforms,
    // not fifty buffers.
    expect(first.geometry).toBe(second.geometry);
    expect(first.material).toBe(second.material);
    expect(first.geometry.getAttribute("position").count).toBeGreaterThan(1);
    // Every mote carries its own brightness, which is what keeps the ring from reading as a solid
    // painted circle.
    const colors = first.geometry.getAttribute("color");
    expect(colors.count).toBe(first.geometry.getAttribute("position").count);
    expect(colors.getX(0)).not.toBe(colors.getX(1));

    // The halo is what makes the ring READ over grass (feedback #22): additive specks alone lift
    // green towards white, so the shape underneath is tinted instead, and it is shared like
    // everything else here.
    const halos = halosIn(root);
    expect(halos).toHaveLength(2);
    const [firstHalo, secondHalo] = halos;
    if (!firstHalo || !secondHalo) throw new Error("expected two halos");
    expect(firstHalo.geometry).toBe(secondHalo.geometry);
    expect(firstHalo.material).toBe(secondHalo.material);
    expect((firstHalo.material as THREE.MeshBasicMaterial).blending).toBe(THREE.NormalBlending);
    // Laid flat in the GEOMETRY, not per mesh: the spin the group carries would undo a mesh
    // rotation and stand the halo up on its edge.
    expect(firstHalo.rotation.x).toBe(0);
    const y = firstHalo.geometry.getAttribute("position");
    expect(y.getY(0)).toBeCloseTo(0, 5);

    layer.dispose();
  });

  it("turns the dust, and drops a marker without freeing the geometry its neighbours share", () => {
    const { layer, root } = harness();
    layer.sync(
      { ...empty, events: [markerEvent, { ...markerEvent, id: "chest", col: 9, row: 2 }] },
      0,
    );
    const [first, second] = motesIn(root);
    const [firstMarker, secondMarker] = markersIn(root);
    if (!first || !second || !firstMarker || !secondMarker) {
      throw new Error("expected two markers");
    }

    layer.update(0);
    const start = firstMarker.rotation.y;
    layer.update(1300);
    expect(firstMarker.rotation.y).toBeGreaterThan(start);
    expect(secondMarker.rotation.y).toBe(firstMarker.rotation.y);

    // One marker leaves. Detaching it must not free the buffers its neighbour is still drawing
    // from, and three.js will not tell us afterwards: `dispose()` frees GPU resources and leaves
    // the JS-side attributes readable, so the call itself is what has to be watched.
    const freed = vi.spyOn(first.geometry, "dispose");
    layer.sync({ ...empty, events: [markerEvent] }, 1);
    expect(motesIn(root)).toHaveLength(1);
    expect(halosIn(root)).toHaveLength(1);
    expect(freed).not.toHaveBeenCalled();
    const survived = firstMarker.rotation.y;
    layer.update(2600);
    expect(firstMarker.rotation.y).not.toBe(survived);

    // The layer owns them, so tearing it down is what frees them, exactly once.
    layer.dispose();
    expect(freed).toHaveBeenCalledTimes(1);
  });
});

describe("Hd2dVisualLayer skid decal", () => {
  const hero = {
    x: 0,
    y: 0,
    z: 0,
    facing: { x: 0, z: 1 },
    swimming: false,
  } as PlayerSnapshot;

  /** One frame: the client emits `glisse` every frame, so a slide is a run of them. */
  function frame(
    layer: Hd2dVisualLayer,
    clock: { mockReturnValue(v: number): unknown },
    at: number,
    intensity: number,
  ): void {
    clock.mockReturnValue(at);
    layer.playHeroMovement([{ t: "glisse", intensite: intensity }], hero);
    layer.update(at);
  }

  it("never paints the ground for the tail of an ordinary stop", () => {
    const { layer, root } = harness();
    const skid = root.getObjectByName("hero-skid");
    if (!skid) throw new Error("the skid decal was not built");
    const clock = vi.spyOn(performance, "now");

    // Releasing a key while still moving is `derapage`'s MAXIMUM, not an edge case, and on grass
    // friction bleeds the speed off in a few frames. That was the reported white bar.
    frame(layer, clock, 1_000, 1);
    expect(skid.visible).toBe(false);
    frame(layer, clock, 1_060, 1);
    expect(skid.visible).toBe(false);
    frame(layer, clock, 1_120, 0);
    expect(skid.visible).toBe(false);
    // And it must not appear as the slide ENDS either: a fade from an alpha that was never lit is
    // still zero.
    layer.update(1_180);
    expect(skid.visible).toBe(false);

    clock.mockRestore();
    layer.dispose();
  });

  it("paints a sustained slide, fading in after the dwell and out when it stops", () => {
    const { layer, root } = harness();
    const skid = root.getObjectByName("hero-skid");
    if (!skid) throw new Error("the skid decal was not built");
    const clock = vi.spyOn(performance, "now");

    // A slide that outlasts the dwell: ice, where the material keeps the hero moving against the
    // input for a second rather than for three frames.
    const start = 2_000;
    for (let at = start; at <= start + SKID_DWELL_MS + SKID_FADE_MS; at += 40) {
      frame(layer, clock, at, 0.9);
    }
    expect(skid.visible).toBe(true);
    if (!(skid instanceof THREE.Mesh)) throw new Error("the skid decal is not a mesh");
    const material = skid.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) throw new Error("unexpected material");
    const lit = material.opacity;
    expect(lit).toBeGreaterThan(0.2);

    // Input regained: it fades rather than blinking off, which is how the old one read as a fault.
    const stopped = start + SKID_DWELL_MS + SKID_FADE_MS + 40;
    frame(layer, clock, stopped, 0);
    expect(skid.visible).toBe(true);
    layer.update(stopped + SKID_FADE_MS / 2);
    expect(material.opacity).toBeLessThan(lit);
    layer.update(stopped + SKID_FADE_MS + 1);
    expect(skid.visible).toBe(false);

    clock.mockRestore();
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
        { t: "entree-eau", liquid: "water", x: 0, y: 0, z: 0 },
      ],
      hero,
    );

    expect(layer.diagnostics().effects).toBe(3);
    layer.dispose();
  });

  it("places the landing ring on the hero's actual underground floor", () => {
    const floorY = -7.2;
    const { layer, root } = harness(20, floorY);
    layer.playHeroMovement([{ t: "reception", force: 0.8 }], { ...hero, y: floorY });
    const ring = root
      .getObjectsByProperty("type", "Mesh")
      .find(
        (child): child is THREE.Mesh =>
          child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry,
      );
    if (!ring) throw new Error("expected a landing ring");

    expect(ring.position.y).toBeCloseTo(floorY + 0.04);
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

  it("never emits swim rings while the hero is in lava", () => {
    const { layer } = harness(20, 2.7, "lava");
    const swimmer = { ...hero, y: 2.7, swimming: true };
    const movement = { breath: 10, maxBreath: 10, swimming: true };

    layer.syncLocalHero(swimmer, movement, 1_000);
    layer.syncLocalHero(swimmer, movement, 1_600);

    expect(layer.diagnostics().effects).toBe(0);
    layer.dispose();
  });

  it("does not reuse water splashes when entering or leaving lava", () => {
    const { layer } = harness(20, 2.7, "lava");
    const swimmer = { ...hero, y: 2.7, swimming: true };

    layer.playHeroMovement(
      [
        { t: "entree-eau", liquid: "lava", x: 0, y: 2.7, z: 0 },
        { t: "sortie-eau", liquid: "lava", x: 0, y: 2.7, z: 0 },
      ],
      swimmer,
    );

    expect(layer.diagnostics().effects).toBe(0);
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
  it("keeps the light power aura attached only while an authoritative buff is live", () => {
    const { layer } = harness();
    layer.syncPowerBuffs([{ id: "hero-1", x: 2, z: 3, endsAt: 2_000 }], 1_000);
    expect(layer.diagnostics().powerBuffs).toBe(1);
    layer.syncPowerBuffs([], 1_100);
    expect(layer.diagnostics().powerBuffs).toBe(0);
    layer.dispose();
  });

  it("keeps a restrained healing aura only around heroes inside an allied camp", () => {
    const { layer, root } = harness();
    const ringsBefore: THREE.RingGeometry[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.geometry instanceof THREE.RingGeometry) {
        ringsBefore.push(object.geometry);
      }
    });
    layer.syncHealingAuras([{ id: "hero-1", x: 2, z: 3, endsAt: 1_200 }], 1_000);
    expect(layer.diagnostics().healingAuras).toBe(1);
    const healingSpheres: THREE.SphereGeometry[] = [];
    const ringsAfter: THREE.RingGeometry[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.geometry instanceof THREE.SphereGeometry) healingSpheres.push(object.geometry);
      if (object.geometry instanceof THREE.RingGeometry) ringsAfter.push(object.geometry);
    });
    expect(healingSpheres).toHaveLength(1);
    expect(ringsAfter).toHaveLength(ringsBefore.length);
    layer.syncHealingAuras([], 1_100);
    expect(layer.diagnostics().healingAuras).toBe(0);
    layer.dispose();
  });

  it("tracks a catapulted meat ration until its authoritative removal", () => {
    const { layer } = harness();
    layer.showRation(
      {
        t: "peasant.ration",
        id: "ration-1",
        actorId: "peasant-1",
        originX: 0,
        originY: 0.4,
        originZ: 0,
        x: 8,
        y: 0.2,
        z: -4,
        launchedAt: 1_000,
        landsAt: 1_900,
        fadeAt: 31_900,
        expiresAt: 32_900,
      },
      1_000,
      1_900,
      31_900,
      32_900,
    );
    expect(layer.diagnostics().rations).toBe(1);
    layer.removeRation("ration-1");
    expect(layer.diagnostics().rations).toBe(0);
    layer.dispose();
  });

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

describe("Hd2dVisualLayer spawn marker", () => {
  const base = {
    cols: 20,
    rows: 15,
    showGrid: false,
    showCollisions: false,
    dim: false,
    colliders: [],
  };

  it("anchors editor overlays to the selected raised underground floor", () => {
    const { layer, root } = harness(20, -6.3);
    layer.setEditorGroundElevation(-7.2);
    layer.setEditorOverlay({ ...base, spawn: { x: 0.5, z: -2.5 } });

    const marker = root.getObjectByName("editor-spawn");
    expect(marker?.position.y).toBeGreaterThan(-6.3);
    expect(marker?.position.y).toBeLessThan(-6);
    layer.dispose();
  });

  it("distinguishes walkable platform tops from solid collision in the editor overlay", () => {
    const { layer, root } = harness();
    layer.setEditorOverlay({
      ...base,
      showCollisions: true,
      colliders: [
        { x: -1.5, z: -0.5, w: 3, h: 1, top: 0.9 },
        { x: -1.5, z: -0.5, w: 3, h: 0.11 },
      ],
    });

    const platform = root.getObjectByName("editor-walkable-platform");
    const solid = root.getObjectByName("editor-solid-collision");
    expect(platform?.position.y).toBeCloseTo(1);
    expect(solid?.position.y).toBeCloseTo(0.1);
    expect((platform as THREE.Mesh).material).not.toBe((solid as THREE.Mesh).material);
    layer.dispose();
  });

  it("draws a selected building footprint with two width handles and one depth handle", () => {
    const { layer, root } = harness();
    const buildingResize = {
      anchor: { x: 0, z: 1 },
      outline: [
        { x: -2, z: 1 },
        { x: 2, z: 1 },
        { x: 2, z: -2 },
        { x: -2, z: -2 },
      ],
      widthHandles: [
        { x: -2, z: -0.5 },
        { x: 2, z: -0.5 },
      ] as const,
      depthHandle: { x: 0, z: -2 },
      hoverAxis: "width" as const,
      activeAxis: null,
      valid: true,
    };
    layer.setEditorOverlay({ ...base, buildingResize });

    expect(root.getObjectByName("editor-building-resize")).toBeDefined();
    expect(root.getObjectByName("editor-building-resize-width-0")?.position.x).toBeCloseTo(-2);
    expect(root.getObjectByName("editor-building-resize-width-1")?.position.x).toBeCloseTo(2);
    expect(root.getObjectByName("editor-building-resize-depth")?.position.z).toBeCloseTo(-2);
    expect(root.getObjectByName("editor-building-resize-anchor")?.position).toMatchObject({
      x: 0,
      z: 1,
    });

    layer.setEditorOverlay({
      ...base,
      buildingResize: { ...buildingResize, hoverAxis: null, valid: false },
    });
    const outline = root.getObjectByName("editor-building-resize-outline") as THREE.LineSegments;
    expect((outline.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xef5350);
    layer.dispose();
  });

  it("draws a selected bridge footprint with independent length and width handles", () => {
    const { layer, root } = harness();
    const bridgeResize = {
      anchor: { x: 0.5, z: 1 },
      outline: [
        { x: -1, z: 1 },
        { x: 2, z: 1 },
        { x: 2, z: 0 },
        { x: -1, z: 0 },
      ],
      handles: [
        { side: "length-start" as const, axis: "length" as const, point: { x: -1, z: 0.5 } },
        { side: "length-end" as const, axis: "length" as const, point: { x: 2, z: 0.5 } },
        { side: "width-start" as const, axis: "width" as const, point: { x: 0.5, z: 0 } },
        { side: "width-end" as const, axis: "width" as const, point: { x: 0.5, z: 1 } },
      ],
      hoverSide: "length-end" as const,
      activeSide: null,
      valid: true,
    };
    layer.setEditorOverlay({ ...base, bridgeResize });

    expect(root.getObjectByName("editor-bridge-resize")).toBeDefined();
    expect(root.getObjectByName("editor-bridge-resize-length-start")?.position).toMatchObject({
      x: -1,
      z: 0.5,
    });
    expect(root.getObjectByName("editor-bridge-resize-length-end")?.position).toMatchObject({
      x: 2,
      z: 0.5,
    });
    expect(root.getObjectByName("editor-bridge-resize-width-start")?.position).toMatchObject({
      x: 0.5,
      z: 0,
    });
    expect(root.getObjectByName("editor-bridge-resize-width-end")?.position).toMatchObject({
      x: 0.5,
      z: 1,
    });
    expect(root.getObjectByName("editor-bridge-resize-anchor")?.position).toMatchObject({
      x: 0.5,
      z: 1,
    });

    layer.setEditorOverlay({
      ...base,
      bridgeResize: { ...bridgeResize, hoverSide: null, valid: false },
    });
    const outline = root.getObjectByName("editor-bridge-resize-outline") as THREE.LineSegments;
    expect((outline.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xef5350);
    layer.dispose();
  });

  it("draws the selected 3D element's rotation arm and highlighted map handle", () => {
    const { layer, root } = harness();
    layer.setEditorOverlay({
      ...base,
      elementRotation: {
        anchor: { x: 1, z: 2 },
        handle: { x: -1, z: 2 },
        angle: 90,
        hovered: true,
        active: false,
        valid: true,
      },
    });

    expect(root.getObjectByName("editor-element-rotation-arm")).toBeDefined();
    expect(root.getObjectByName("editor-element-rotation-handle")?.position).toMatchObject({
      x: -1,
      z: 2,
    });
    layer.dispose();
  });

  it("renders a bridge placement ghost at the compiler-selected bank elevation", () => {
    const { layer, root } = harness();
    layer.setEditorPreviewArt({
      texture: new THREE.Texture(),
      height: 1,
      aspect: 1,
      bridgeOrientation: "horizontal",
    });
    layer.setEditorOverlay({
      ...base,
      assetPreview: {
        point: { x: 2, z: 3 },
        footprint: [],
        valid: true,
        elevation: 1.8,
      },
    });

    expect(root.getObjectByName("bridge-horizontal")?.position).toMatchObject({
      x: 2,
      y: 1.8,
      z: 2.5,
    });
    layer.dispose();
  });

  it("draws the spawn where the overlay puts it, and nothing when there is none", () => {
    const { layer, root } = harness();
    layer.setEditorOverlay({ ...base, spawn: { x: 0.5, z: -2.5 } });
    const marker = root.getObjectByName("editor-spawn");
    expect(marker).toBeDefined();
    expect(marker?.position.x).toBeCloseTo(0.5);
    expect(marker?.position.z).toBeCloseTo(-2.5);

    layer.setEditorOverlay({ ...base, spawn: null });
    expect(root.getObjectByName("editor-spawn")).toBeUndefined();
  });

  it("reuses the same marker across hovers instead of rebuilding it", () => {
    // `setEditorOverlay` runs on every pointer move. Rebuilding a pin's geometry there is the
    // stall `c690d0c2` paid for once already — the grid is cached for the same reason.
    const { layer, root } = harness();
    layer.setEditorOverlay({ ...base, spawn: { x: 0.5, z: -2.5 }, hover: { x: 1.5, z: 1.5 } });
    const first = root.getObjectByName("editor-spawn");
    layer.setEditorOverlay({ ...base, spawn: { x: 0.5, z: -2.5 }, hover: { x: 2.5, z: 2.5 } });
    expect(root.getObjectByName("editor-spawn")).toBe(first);

    // And it follows the spawn when the spawn actually moves, without being replaced.
    layer.setEditorOverlay({ ...base, spawn: { x: -6.5, z: -5.5 } });
    const moved = root.getObjectByName("editor-spawn");
    expect(moved).toBe(first);
    expect(moved?.position.x).toBeCloseTo(-6.5);
  });

  it("marks the start with the ghost knight alone, and nothing that pulses", () => {
    const { layer, root } = harness();
    layer.setEditorOverlay({ ...base, spawn: { x: 0.5, z: -2.5 } });
    const marker = root.getObjectByName("editor-spawn");
    expect(marker).toBeDefined();

    // The green ring that used to sit under the knight is gone (feedback #23), and with it the
    // per-frame pulse: nothing on this group may animate from `update()` any more.
    expect(marker?.getObjectByName("editor-spawn-ring")).toBeUndefined();
    layer.update(0);
    layer.update(400);
    expect(marker?.getObjectByName("editor-spawn-ring")).toBeUndefined();
    layer.dispose();
  });
});
