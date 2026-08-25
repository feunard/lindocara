import {
  FACTION_BUILDING_FACTIONS,
  factionBuildingModelForArchetype,
} from "@lindocara/engine/faction-buildings.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  BRIDGE_DECK_LENGTH,
  BRIDGE_DECK_WIDTH,
  BRIDGE_VISUAL_LIFT,
  buildingVolumeDimensions,
  makeBridgeVolume,
  makeBuildingVolume,
} from "../src/hd2d/building-volumes.js";

function texture(): THREE.Texture {
  return new THREE.Texture();
}

function building(
  archetype: Parameters<typeof makeBuildingVolume>[0]["archetype"],
  dimensions?: Parameters<typeof makeBuildingVolume>[0]["dimensions"],
  faction?: Parameters<typeof makeBuildingVolume>[0]["faction"],
) {
  return makeBuildingVolume({
    archetype,
    ...(dimensions ? { dimensions } : {}),
    ...(faction ? { faction } : {}),
    state: "standing",
    front: texture(),
    wall: texture(),
    roof: texture(),
    stone: texture(),
    blueStone: texture(),
    wood: texture(),
    roofColor: 0x4da9c7,
  });
}

function uvSpan(mesh: THREE.Mesh, groupIndex: number): { u: number; v: number } {
  const group = mesh.geometry.groups[groupIndex];
  const index = mesh.geometry.index;
  const uv = mesh.geometry.getAttribute("uv");
  if (!group || !index || !(uv instanceof THREE.BufferAttribute)) {
    throw new Error("grouped UV geometry missing");
  }
  const vertices = new Set<number>();
  for (let offset = group.start; offset < group.start + group.count; offset += 1) {
    vertices.add(index.getX(offset));
  }
  const us = [...vertices].map((vertex) => uv.getX(vertex));
  const vs = [...vertices].map((vertex) => uv.getY(vertex));
  return { u: Math.max(...us) - Math.min(...us), v: Math.max(...vs) - Math.min(...vs) };
}

describe("native HD-2D building volumes", () => {
  it.each([
    ["goblin", "scrap-patch"],
    ["orc-troll", "iron-reinforcement"],
    ["beastfolk", "hide-panel"],
    ["wild-tribe", "reed-bundle"],
  ] as const)("builds a distinct %s housing pack signature", (faction, signature) => {
    const model = factionBuildingModelForArchetype(faction, "housing-a");
    const visual = building(model.archetype, undefined, faction);
    expect(visual.mesh.getObjectByName(signature)).toBeDefined();
    expect(visual.mesh.getObjectByName("native-architecture")).toBeDefined();
    visual.dispose();
  });

  it("builds two models for all five purposes in every faction pack", () => {
    for (const faction of FACTION_BUILDING_FACTIONS) {
      for (const purpose of [
        "housing",
        "command",
        "training",
        "community",
        "daily-life",
      ] as const) {
        for (const variant of ["a", "b"] as const) {
          const model = factionBuildingModelForArchetype(faction, `${purpose}-${variant}`);
          const visual = building(model.archetype, undefined, faction);
          expect(visual.mesh.getObjectsByProperty("type", "Mesh").length).toBeGreaterThan(8);
          visual.dispose();
        }
      }
    }
  });

  it.each(["house", "tower", "windmill", "archery", "barracks", "monastery", "castle"] as const)(
    "builds %s as complete native architecture behind its authored front threshold",
    (archetype) => {
      const visual = building(archetype);
      const size = buildingVolumeDimensions(archetype);
      const architecture = visual.mesh.getObjectByName("native-architecture");
      expect(architecture?.position.z).toBeCloseTo(-size.depth / 2);
      expect(visual.mesh.getObjectByName("generated-front-elevation")).toBeUndefined();
      expect(visual.mesh.getObjectsByProperty("type", "Mesh").length).toBeGreaterThan(8);
      visual.dispose();
    },
  );

  it("repeats facade and roof modules across a resized house instead of magnifying one texture", () => {
    const visual = building("house", { width: 5, depth: 3.125 });
    const wall = visual.mesh.getObjectByName("plaster-house");
    const roof = visual.mesh.getObjectByName("blue-roof-slope");
    if (!(wall instanceof THREE.Mesh) || !(roof instanceof THREE.Mesh)) {
      throw new Error("resized house shell missing");
    }

    // Box groups 4/5 are the front/back faces; the 2-world-unit facade module now repeats 2.5x.
    expect(uvSpan(wall, 4)).toEqual({ u: 2.5, v: 1 });
    // Roof top/bottom faces repeat the one-tile shingles in both slope and depth directions.
    expect(uvSpan(roof, 2).u).toBeGreaterThan(2.5);
    expect(uvSpan(roof, 2).v).toBeGreaterThan(3);
    visual.dispose();
  });

  it("compensates texture repetition for internally scaled round buildings", () => {
    const visual = building("tower", { width: 5, depth: 3.125 });
    const wall = visual.mesh.getObjectByName("stone-watchtower");
    if (!(wall instanceof THREE.Mesh)) throw new Error("resized tower wall missing");

    expect(uvSpan(wall, 0).u).toBeGreaterThan(5);
    expect(uvSpan(wall, 0).v).toBeGreaterThan(1);
    visual.dispose();
  });

  it.each(["house", "tower", "windmill", "archery", "barracks", "monastery", "castle"] as const)(
    "regenerates resized %s architecture from the requested footprint",
    (archetype) => {
      const native = building(archetype);
      const visual = building(archetype, { width: 5, depth: 3.125 });
      const nativeArchitecture = native.mesh.getObjectByName("native-architecture");
      const architecture = visual.mesh.getObjectByName("native-architecture");
      if (!nativeArchitecture || !architecture) throw new Error("native architecture missing");
      const nativeBounds = new THREE.Box3().setFromObject(nativeArchitecture);
      const bounds = new THREE.Box3().setFromObject(architecture);
      expect(bounds.max.x - bounds.min.x).toBeGreaterThan(
        (nativeBounds.max.x - nativeBounds.min.x) * 1.35,
      );
      expect(bounds.max.z - bounds.min.z).toBeGreaterThan(
        (nativeBounds.max.z - nativeBounds.min.z) * 1.2,
      );
      expect(architecture.position.z).toBeCloseTo(-3.125 / 2);
      native.dispose();
      visual.dispose();
    },
  );

  it("keeps the stone tower open and crenellated at every camera angle instead of capping a cylinder with a cone", () => {
    const visual = building("tower");
    expect(visual.mesh.getObjectByName("tower-deck")).toBeDefined();
    expect(visual.mesh.getObjectsByProperty("name", "tower-battlement")).toHaveLength(12);
    expect(visual.mesh.getObjectByName("cone-roof")).toBeUndefined();
    expect(visual.mesh.getObjectsByProperty("name", "window")).toHaveLength(3);
    expect(visual.mesh.getObjectsByProperty("name", "stone-block").length).toBeGreaterThan(12);
    expect(visual.mesh.getObjectsByProperty("name", "ink-outline").length).toBeGreaterThan(20);
    visual.dispose();
  });

  it("gives the archery guild a full open range and leaves the barracks as one integrated hall", () => {
    const guild = building("archery");
    expect(guild.mesh.getObjectsByProperty("name", "archery-target")).toHaveLength(2);
    expect(guild.mesh.getObjectsByProperty("name", "range-post")).toHaveLength(2);
    guild.dispose();

    const barracks = building("barracks");
    expect(barracks.mesh.getObjectByName("fortified-hall")).toBeDefined();
    expect(barracks.mesh.getObjectsByProperty("name", "corner-tower")).toHaveLength(0);
    expect(barracks.mesh.getObjectsByProperty("name", "battlement").length).toBeGreaterThan(0);
    barracks.dispose();
  });

  it.each(["house", "tower", "windmill", "archery", "barracks", "monastery", "castle"] as const)(
    "gives the %s a recessed plank door instead of a flat blue portal",
    (archetype) => {
      const visual = building(archetype);
      const door = visual.mesh.getObjectByName("arched-door");
      const leaf = door?.getObjectByName("door-leaf");
      const recess = door?.getObjectByName("door-recess");
      const handle = door?.getObjectByName("door-handle");
      expect(door).toBeDefined();
      expect(leaf?.position.z).toBeLessThan(handle?.position.z ?? 0);
      expect(recess?.position.z).toBeLessThan(leaf?.position.z ?? 0);
      expect(door?.getObjectsByProperty("name", "door-plank-gap")).toHaveLength(4);
      expect(door?.getObjectsByProperty("name", "door-timber-brace")).toHaveLength(2);
      expect(door?.getObjectsByProperty("name", "door-hinge-strap")).toHaveLength(2);
      expect(visual.mesh.getObjectsByProperty("name", "door-arch-stone")).toHaveLength(5);
      expect(visual.mesh.getObjectByName("door-threshold")).toBeDefined();
      visual.dispose();
    },
  );

  it("builds the windmill as a tapered mill with four lattice sails, not a tower facade", () => {
    const visual = building("windmill");
    expect(visual.mesh.getObjectByName("mill-body")).toBeDefined();
    expect(visual.mesh.getObjectByName("stone-tower")).toBeUndefined();
    expect(visual.mesh.getObjectByName("generated-front-elevation")).toBeUndefined();
    const rotor = visual.mesh.getObjectByName("windmill-rotor");
    if (!rotor) throw new Error("windmill rotor missing");
    expect([0, 1, 2, 3].map((index) => rotor.getObjectByName(`sail-${index}`))).not.toContain(
      undefined,
    );
    const before = rotor.rotation.z;
    visual.update(4_000);
    expect(rotor.rotation.z).not.toBe(before);
    visual.dispose();
  });

  it.each([
    [0, 0],
    [1, -Math.PI / 2],
    [2, -Math.PI],
    [3, (-3 * Math.PI) / 2],
  ] as const)("fixes authored orientation %s on the world volume", (orientation, yaw) => {
    const visual = makeBuildingVolume({
      archetype: "house",
      state: "standing",
      front: texture(),
      wall: texture(),
      roof: texture(),
      stone: texture(),
      blueStone: texture(),
      wood: texture(),
      roofColor: 0x4da9c7,
      orientation,
    });
    expect(visual.mesh.rotation.y).toBeCloseTo(yaw);
    visual.dispose();
  });

  it("applies a native building's free authored angle without quarter-turn snapping", () => {
    const visual = makeBuildingVolume({
      archetype: "house",
      state: "standing",
      front: texture(),
      wall: texture(),
      roof: texture(),
      stone: texture(),
      blueStone: texture(),
      wood: texture(),
      roofColor: 0x4da9c7,
      rotation: 37,
    });
    expect(visual.mesh.rotation.y).toBeCloseTo((-37 * Math.PI) / 180);
    visual.dispose();
  });

  it.each(["horizontal", "vertical"] as const)(
    "aligns the %s bridge deck and rails to its authored three-cell footprint",
    (orientation) => {
      const visual = makeBridgeVolume(texture(), orientation);
      visual.placeAt(2, 0.9, 3);
      expect(visual.mesh.position.z).toBe(orientation === "horizontal" ? 2.5 : 1.5);
      const deck = visual.mesh.getObjectByName("walkable-deck");
      if (!(deck instanceof THREE.Group)) {
        throw new Error("bridge deck missing");
      }
      expect(deck.getObjectsByProperty("name", "bridge-plank")).toHaveLength(11);
      const bounds = new THREE.Box3().setFromObject(deck);
      expect(bounds.max.y).toBeGreaterThanOrEqual(BRIDGE_VISUAL_LIFT);
      expect(bounds.max.y).toBeLessThan(0.12);
      const visibleWidth = bounds.max.x - bounds.min.x;
      const visibleDepth = bounds.max.z - bounds.min.z;
      const along = orientation === "horizontal" ? visibleWidth : visibleDepth;
      const across = orientation === "horizontal" ? visibleDepth : visibleWidth;
      expect(along).toBeGreaterThan(BRIDGE_DECK_LENGTH - 0.08);
      expect(along).toBeLessThanOrEqual(BRIDGE_DECK_LENGTH + 0.08);
      expect(across).toBeGreaterThan(BRIDGE_DECK_WIDTH - 0.1);
      expect(across).toBeLessThanOrEqual(BRIDGE_DECK_WIDTH + 0.08);
      expect(visual.mesh.getObjectsByProperty("name", "bridge-rope")).toHaveLength(4);
      expect(visual.mesh.getObjectsByProperty("name", "bridge-post")).toHaveLength(6);
      visual.dispose();
    },
  );

  it("regenerates a resized bridge instead of repeating fixed 3x1 geometry", () => {
    const visual = makeBridgeVolume(texture(), "horizontal", { length: 7, width: 2 });
    visual.placeAt(2, 0.9, 3);
    expect(visual.mesh.position).toMatchObject({ x: 2, y: 0.9, z: 3 });
    const deck = visual.mesh.getObjectByName("walkable-deck");
    if (!(deck instanceof THREE.Group)) throw new Error("bridge deck missing");
    expect(deck.getObjectsByProperty("name", "bridge-plank").length).toBeGreaterThan(20);
    const bounds = new THREE.Box3().setFromObject(deck);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(7, 1);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(1.85);
    expect(visual.mesh.getObjectsByProperty("name", "bridge-post").length).toBeGreaterThan(6);
    visual.dispose();
  });

  it("applies absolute free angles to either bridge source orientation", () => {
    const horizontal = makeBridgeVolume(texture(), "horizontal", undefined, 37);
    const vertical = makeBridgeVolume(texture(), "vertical", undefined, 37);
    expect(horizontal.mesh.rotation.y).toBeCloseTo((-37 * Math.PI) / 180);
    expect(vertical.mesh.rotation.y).toBeCloseTo((53 * Math.PI) / 180);
    horizontal.dispose();
    vertical.dispose();
  });
});
